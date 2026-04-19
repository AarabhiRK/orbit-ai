import { GoogleGenerativeAI } from "@google/generative-ai"
import { GeminiConfigurationError, GeminiNarrativeError } from "./orbitErrors.js"

/** @type {null | ((payload: object) => Promise<object>)} */
let polishStub = null

/** Test-only: bypass real Gemini (node --test). */
export function __setGeminiPolishStub(fn) {
  polishStub = typeof fn === "function" ? fn : null
}

export function __clearGeminiPolishStub() {
  polishStub = null
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

function isNonEmptyString(v, min = 8) {
  if (typeof v !== "string") return false
  return v.trim().length >= min
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

/**
 * Narrative + constrained selection among top 3. Risk stays server truth.
 * Requires GEMINI_API_KEY unless a test stub is installed via __setGeminiPolishStub.
 *
 * @param {object} payload
 * @returns {Promise<{ reason: string, future_impact: string, tradeoffs: string, selected_task_id: string | null, modelId: string }>}
 */
export async function polishOrbitNarrative(payload) {
  if (polishStub) {
    const out = await polishStub(payload)
    if (!out || typeof out !== "object") {
      throw new GeminiNarrativeError("Test stub returned invalid polish payload")
    }
    const modelId = typeof out.modelId === "string" ? out.modelId : "test-stub"
    return {
      reason: String(out.reason ?? "").trim().slice(0, 2000),
      future_impact: String(out.future_impact ?? "").trim().slice(0, 2000),
      tradeoffs: String(out.tradeoffs ?? "").trim().slice(0, 1500),
      selected_task_id:
        typeof out.selected_task_id === "string" ? out.selected_task_id.trim() : null,
      modelId,
    }
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new GeminiConfigurationError()
  }

  const modelId = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash"
  const timeoutMs = Math.max(
    3000,
    Math.min(60_000, Number(process.env.GEMINI_TIMEOUT_MS) || 14_000),
  )

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.42,
    },
  })

  const recentRuns = payload.debug?.received?.memory?.recentRuns ?? []
  const top3 =
    payload.candidates_top_3 ?? payload.orbit?.ranked?.slice(0, 3) ?? []
  const candidateIds = top3.map((t) => t.id).filter(Boolean)

  const brief = JSON.stringify({
    recommended_action: payload.action,
    deterministic_reason: payload.reason,
    deterministic_risk: payload.risk,
    deterministic_future_impact: payload.future_impact,
    confidence_percent: payload.confidence,
    confidence_breakdown: payload.confidence_breakdown ?? null,
    top_ranked_task: payload.orbit?.ranked?.[0] ?? null,
    candidates_top_3: top3,
    candidate_ids_allowed: candidateIds,
    alternatives: payload.alternatives ?? [],
    user_model_summary: payload.userModel?.summary ?? null,
    behavior_profile: payload.userModel?.behavior_profile ?? null,
    sentinel_by_candidate: payload.sentinel_by_candidate ?? null,
    sentinel: payload.sentinel ?? null,
    session_memory_recent: recentRuns,
  })

  const prompt = `You are ORBIT's narrative layer for a personal life dashboard: one place where a student (or busy builder) sees goals, energy, time budget, ranked tasks, schedule blocks, and risk-style signals—explained in plain language.

The JSON below was produced by deterministic ORBIT Core (fixed math + rules). candidate_ids_allowed lists the ONLY task ids you may select as primary focus.

You MUST output selected_task_id as EXACTLY one of candidate_ids_allowed, OR null to keep the default (#1 in candidates_top_3). Never pick a task outside that list.

Use candidates_top_3 and alternatives for tradeoff analysis only.

If session_memory_recent or behavior_profile is non-empty, reference briefly—do not invent facts.

Tone: supportive, concrete, and dashboard-clear (short paragraphs the user can scan).

Fields:
- reason: concise why the selected (or default) primary focus makes sense for their day and goals (under 650 chars).
- future_impact: concrete next 24–72h story grounded in the numbers in the JSON (under 650 chars).
- tradeoffs: 140–550 chars comparing #1 vs #2 vs #3 on urgency/goal/feasibility/risk scores in the JSON.
- selected_task_id: string id from candidate_ids_allowed, or null.

Output ONLY valid JSON (no markdown fences):
{"reason":"...","future_impact":"...","tradeoffs":"...","selected_task_id":"task_0"}

INPUT:
${brief}`

  try {
    const result = await raceWithTimeout(timeoutMs, () =>
      model.generateContent(prompt),
    )

    let text
    try {
      text = result.response.text()
    } catch (e) {
      throw new GeminiNarrativeError(
        `Gemini response had no text: ${e?.message ?? String(e)}`,
      )
    }

    const parsed = extractJsonObject(text)
    if (!parsed) {
      throw new GeminiNarrativeError(
        "Gemini returned text that was not valid JSON with reason/future_impact fields.",
      )
    }

    const r = parsed.reason
    const f = parsed.future_impact
    if (!isNonEmptyString(r) || !isNonEmptyString(f)) {
      throw new GeminiNarrativeError(
        "Gemini JSON missing non-empty reason or future_impact (min 8 chars each).",
      )
    }

    let tradeoffs = parsed.tradeoffs
    if (!isNonEmptyString(tradeoffs, 20)) {
      tradeoffs = payload.tradeoffs ?? ""
    }
    tradeoffs = String(tradeoffs).trim().slice(0, 1500)

    let selected_task_id = null
    const sel = parsed.selected_task_id
    if (typeof sel === "string") {
      const t = sel.trim()
      if (candidateIds.includes(t)) selected_task_id = t
    } else if (sel === null || sel === undefined) {
      selected_task_id = null
    }

    return {
      reason: r.trim().slice(0, 2000),
      future_impact: f.trim().slice(0, 2000),
      tradeoffs,
      selected_task_id,
      modelId,
    }
  } catch (err) {
    if (err instanceof GeminiNarrativeError || err instanceof GeminiConfigurationError) {
      throw err
    }
    console.warn("[ORBIT] Gemini narrative failed:", err?.message ?? err)
    throw new GeminiNarrativeError(err?.message ?? String(err))
  }
}
