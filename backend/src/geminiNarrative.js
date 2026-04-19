import { GoogleGenerativeAI } from "@google/generative-ai"

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

function isNonEmptyString(v, min = 8) {
  if (typeof v !== "string") return false
  return v.trim().length >= min
}

/**
 * Race the Gemini call so a hung request does not block ORBIT forever.
 */
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

/**
 * Rewrites reason / risk / future_impact only. Scores and action stay from ORBIT core.
 * Returns null on any failure → caller keeps deterministic strings unchanged.
 *
 * @param {object} payload — full object returned by core ORBIT (before LLM)
 * @returns {Promise<{ reason: string, risk: string, future_impact: string, modelId: string } | null>}
 */
export async function polishOrbitNarrative(payload) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) return null

  const modelId = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash"
  const timeoutMs = Math.max(
    3000,
    Math.min(60_000, Number(process.env.GEMINI_TIMEOUT_MS) || 14_000),
  )

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      maxOutputTokens: 768,
      temperature: 0.45,
    },
  })

  const recentRuns = payload.debug?.received?.memory?.recentRuns ?? []
  const recv = payload.debug?.received ?? {}

  const brief = JSON.stringify({
    recommended_action: payload.action,
    user_short_term_goals:
      typeof recv.shortTermGoals === "string" ? recv.shortTermGoals : "",
    user_long_term_goals:
      typeof recv.longTermGoals === "string" ? recv.longTermGoals : "",
    deterministic_reason: payload.reason,
    deterministic_risk: payload.risk,
    deterministic_future_impact: payload.future_impact,
    confidence_percent: payload.confidence,
    top_ranked_task: payload.orbit?.ranked?.[0] ?? null,
    ranked_tasks: payload.orbit?.ranked ?? [],
    sentinel: payload.sentinel ?? null,
    session_memory_recent: recentRuns,
  })

  const prompt = `You are ORBIT: an execution + foresight copilot. The user is busy and tired. Your job is to make the system's decision feel human, accountable, and forward-looking—without changing the decision itself.

Rules (strict):
- The JSON was produced by ORBIT's deterministic engine (scoring + Sentinel). Treat those facts as ground truth.
- You MUST NOT contradict recommended_action or suggest a different primary task. Do not name a runner-up as the thing to do now.
- When user_short_term_goals / user_long_term_goals are non-empty, tie your language to them only where it honestly fits the ranked task and scores—no empty cheerleading.
- If session_memory_recent is non-empty, you may reference it briefly for tone (patterns, repetition)—never invent events not implied by that array.
- Keep each of reason, risk, and future_impact under 600 characters. Stay concrete; mirror urgency/feasibility/goal-fit and Sentinel (defer impact, workload) using the words already implied by deterministic_risk / deterministic_future_impact—do not invent new percentages or metrics not present in the JSON.

Field intent:
- reason: Why this ONE action now (deadline pressure, fit to goals, time/mood realism). Short, confident, no jargon wall.
- risk: What gets worse if they defer or drift (Sentinel / backlog pressure)—one sharp paragraph.
- future_impact: One sentence on the upside of acting now vs letting the stack compound.

Output ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{"reason":"...","risk":"...","future_impact":"..."}

INPUT:
${brief}`

  try {
    const result = await raceWithTimeout(timeoutMs, () =>
      model.generateContent(prompt),
    )

    let text
    try {
      text = result.response.text()
    } catch {
      return null
    }

    const parsed = extractJsonObject(text)
    if (!parsed) return null

    const r = parsed.reason
    const k = parsed.risk
    const f = parsed.future_impact

    // All-or-nothing: partial or empty LLM output → full fallback to ORBIT core copy
    if (!isNonEmptyString(r) || !isNonEmptyString(k) || !isNonEmptyString(f)) {
      return null
    }

    return {
      reason: r.trim().slice(0, 2000),
      risk: k.trim().slice(0, 2000),
      future_impact: f.trim().slice(0, 2000),
      modelId,
    }
  } catch (err) {
    console.warn("[ORBIT] Gemini polish failed (using core copy):", err?.message ?? err)
    return null
  }
}
