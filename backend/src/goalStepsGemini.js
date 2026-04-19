import { GoogleGenerativeAI } from "@google/generative-ai"
import { extractJsonObject } from "./geminiJsonExtract.js"
import {
  getGeminiModelCandidates,
  isGeminiModelUnavailableError,
  isGeminiRetryableQuotaError,
} from "./geminiModel.js"
import { GeminiConfigurationError, GeminiNarrativeError } from "./orbitErrors.js"

/** @type {null | ((input: { goal: string, shortTermContext: string }) => Promise<{ steps: { title: string, dayOffset: number }[] }>)} */
let goalStepsStub = null

export function __setGoalStepsStub(fn) {
  goalStepsStub = typeof fn === "function" ? fn : null
}

export function __clearGoalStepsStub() {
  goalStepsStub = null
}

/** Accept `{ "steps": [...] }` or a root JSON array of step objects. */
function stepsArrayFromParsed(parsed) {
  if (!parsed) return []
  if (Array.isArray(parsed)) return parsed
  if (typeof parsed === "object" && Array.isArray(parsed.steps)) return parsed.steps
  return []
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

/** Minimum steps we require before saving a long-term goal ladder (matches product expectation). */
const MIN_GOAL_STEPS = 4

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
    const steps = normalizeSteps(stepsArrayFromParsed(out))
    if (steps.length < MIN_GOAL_STEPS) {
      throw new GeminiNarrativeError(
        `Goal planner stub returned ${steps.length} steps (tests should return at least ${MIN_GOAL_STEPS}).`,
      )
    }
    return { steps, modelId: "test-stub" }
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new GeminiConfigurationError()
  }

  const modelCandidates = getGeminiModelCandidates()
  const timeoutMs = Math.max(
    4000,
    Math.min(45_000, Number(process.env.GEMINI_GOAL_TIMEOUT_MS) || 18_000),
  )

  const genAI = new GoogleGenerativeAI(apiKey)
  const generationConfig = {
    maxOutputTokens: 2048,
    temperature: 0.45,
  }

  const brief = JSON.stringify({
    long_term_goal: goal,
    short_term_focus: shortTermContext || null,
  })

  const prompt = `You are ORBIT's planning coach inside a personal life dashboard. The user has a long-term goal and (optionally) a short-term focus.

Produce **at least 6** concrete, ordered steps (6–10 is ideal) that move them toward the long-term goal. The app will reject fewer than **4** valid steps, so never return fewer than 6 rows in JSON. Each step must be doable in one sitting (roughly 25–90 minutes of real work). Use clear action titles (each title at least 6 characters). Steps should escalate logically (foundation → momentum → visible outcomes).

Assign each step a dayOffset: integer 0 = today through 13 = about two weeks out. Spread work realistically (do not put everything on day 0).

Output **only** valid JSON — no markdown, no commentary before or after. Shape must be exactly:
{"steps":[{"title":"First concrete step","dayOffset":0},{"title":"Second step","dayOffset":1}]}

INPUT:
${brief}`

  let lastApiErr = null
  for (let i = 0; i < modelCandidates.length; i++) {
    const modelId = modelCandidates[i]
    const model = genAI.getGenerativeModel({ model: modelId, generationConfig })
    try {
      const runOnce = async (p) => {
        const result = await raceWithTimeout(timeoutMs, () => model.generateContent(p))
        let text
        try {
          text = result.response.text()
        } catch (e) {
          throw new GeminiNarrativeError(`Gemini response had no text: ${e?.message ?? e}`)
        }
        const parsed = extractJsonObject(text)
        return normalizeSteps(stepsArrayFromParsed(parsed))
      }

      let steps = await runOnce(prompt)
      const repair1 = `Your previous reply did not include enough valid steps for ORBIT (need at least ${MIN_GOAL_STEPS} after validation).

Return **only** valid JSON — no markdown fences, no explanation, no text before or after the JSON object.

Use exactly this shape with **at least 8** step objects (more is fine; too few will be rejected):
{"steps":[{"title":"Concrete first action here","dayOffset":0},{"title":"Second concrete action","dayOffset":1}]}

Rules:
- Every "title" must be a non-empty string (at least 6 characters), one concrete action per step.
- Every "dayOffset" must be an integer from 0 through 13; spread days across about two weeks (not all on 0).

Goal: ${goal}
Short-term focus: ${shortTermContext || "(none)"}`

      const repair2 = `CRITICAL: Output **only** one JSON object. The "steps" array must contain **at least 8** objects. Each object: {"title":"...","dayOffset":n}.

If you return fewer than ${MIN_GOAL_STEPS} valid steps, the request fails. Do not wrap in markdown.

Goal: ${goal}
Short-term focus: ${shortTermContext || "(none)"}`

      if (steps.length < MIN_GOAL_STEPS) steps = await runOnce(repair1)
      if (steps.length < MIN_GOAL_STEPS) steps = await runOnce(repair2)

      if (steps.length < MIN_GOAL_STEPS) {
        const tryNextModel = i < modelCandidates.length - 1
        if (tryNextModel) {
          console.warn(
            `[ORBIT] Goal steps: model ${modelId} returned only ${steps.length} usable steps (need ${MIN_GOAL_STEPS}); trying next candidate…`,
          )
          continue
        }
        throw new GeminiNarrativeError(
          `Gemini returned too few usable steps after retries (got ${steps.length}; need at least ${MIN_GOAL_STEPS}). Try "Plan steps" again, or phrase the goal as one clear outcome.`,
        )
      }

      return { steps: steps.slice(0, 12), modelId }
    } catch (err) {
      if (err instanceof GeminiNarrativeError || err instanceof GeminiConfigurationError) {
        throw err
      }
      lastApiErr = err
      const tryNext =
        i < modelCandidates.length - 1 &&
        (isGeminiRetryableQuotaError(err) || isGeminiModelUnavailableError(err))
      if (tryNext) {
        console.warn(
          `[ORBIT] Goal steps: model ${modelId} failed (${err?.message ?? err}); trying next candidate…`,
        )
        continue
      }
      console.warn("[ORBIT] Goal steps Gemini failed:", err?.message ?? err)
      throw new GeminiNarrativeError(err?.message ?? String(err))
    }
  }
  console.warn("[ORBIT] Goal steps: all Gemini model candidates failed:", lastApiErr?.message ?? lastApiErr)
  throw new GeminiNarrativeError(lastApiErr?.message ?? "All Gemini model candidates failed.")
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
    const title =
      typeof row.title === "string"
        ? row.title.trim()
        : String(row.title ?? "")
            .trim()
            .slice(0, 200)
    if (title.length < 3 || title.length > 200) continue
    out.push({
      title: title.slice(0, 200),
      dayOffset: clampDayOffset(row.dayOffset),
    })
  }
  return out
}
