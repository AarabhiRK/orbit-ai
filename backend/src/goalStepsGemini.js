import { GoogleGenerativeAI } from "@google/generative-ai"
import { GeminiConfigurationError, GeminiNarrativeError } from "./orbitErrors.js"

/** @type {null | ((input: { goal: string, shortTermContext: string }) => Promise<{ steps: { title: string, dayOffset: number }[] }>)} */
let goalStepsStub = null

export function __setGoalStepsStub(fn) {
  goalStepsStub = typeof fn === "function" ? fn : null
}

export function __clearGoalStepsStub() {
  goalStepsStub = null
}

function extractJsonObject(text) {
  const trimmed = String(text).trim()
  if (!trimmed) return null
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fence ? fence[1].trim() : trimmed
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function raceWithTimeout(ms, run) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms)
  })
  const work = Promise.resolve()
    .then(() => run())
    .finally(() => clearTimeout(timer))
  return Promise.race([work, timeout])
}

function clampDayOffset(n) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 0
  return Math.min(13, Math.max(0, x))
}

/**
 * Turn one long-term goal into ordered steps with suggested spread across the next ~2 weeks.
 *
 * @param {{ goal: string, shortTermContext?: string }} input
 * @returns {Promise<{ steps: { title: string, dayOffset: number }[], modelId: string }>}
 */
export async function planLongTermGoalSteps(input) {
  const goal = String(input.goal ?? "").trim()
  const shortTermContext = String(input.shortTermContext ?? "").trim().slice(0, 220)

  if (goalStepsStub) {
    const out = await goalStepsStub({ goal, shortTermContext })
    const steps = normalizeSteps(out?.steps)
    return { steps, modelId: "test-stub" }
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new GeminiConfigurationError()
  }

  const modelId = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash"
  const timeoutMs = Math.max(
    4000,
    Math.min(45_000, Number(process.env.GEMINI_GOAL_TIMEOUT_MS) || 18_000),
  )

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      maxOutputTokens: 1200,
      temperature: 0.45,
    },
  })

  const brief = JSON.stringify({
    long_term_goal: goal,
    short_term_focus: shortTermContext || null,
  })

  const prompt = `You are ORBIT's planning coach inside a personal life dashboard. The user has a long-term goal and (optionally) a short-term focus.

Produce 6–10 concrete, ordered steps that move them toward the long-term goal. Each step must be doable in one sitting (roughly 25–90 minutes of real work). Steps should escalate logically (foundation → momentum → visible outcomes).

Assign each step a dayOffset: integer 0 = today through 13 = about two weeks out. Spread work realistically (do not put everything on day 0).

Output ONLY valid JSON (no markdown fences):
{"steps":[{"title":"First concrete step","dayOffset":0},{"title":"...","dayOffset":1}]}

INPUT:
${brief}`

  try {
    const result = await raceWithTimeout(timeoutMs, () => model.generateContent(prompt))
    let text
    try {
      text = result.response.text()
    } catch (e) {
      throw new GeminiNarrativeError(`Gemini response had no text: ${e?.message ?? e}`)
    }

    const parsed = extractJsonObject(text)
    const steps = normalizeSteps(parsed?.steps)
    if (steps.length < 4) {
      throw new GeminiNarrativeError("Gemini returned too few steps (need at least 4).")
    }

    return { steps: steps.slice(0, 12), modelId }
  } catch (err) {
    if (err instanceof GeminiNarrativeError || err instanceof GeminiConfigurationError) {
      throw err
    }
    console.warn("[ORBIT] Goal steps Gemini failed:", err?.message ?? err)
    throw new GeminiNarrativeError(err?.message ?? String(err))
  }
}

/**
 * @param {unknown} raw
 * @returns {{ title: string, dayOffset: number }[]}
 */
function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const row of raw) {
    if (!row || typeof row !== "object") continue
    const title = typeof row.title === "string" ? row.title.trim() : ""
    if (title.length < 3 || title.length > 200) continue
    out.push({
      title: title.slice(0, 200),
      dayOffset: clampDayOffset(row.dayOffset),
    })
  }
  return out
}
