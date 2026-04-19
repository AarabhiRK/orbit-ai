import { GoogleGenerativeAI } from "@google/generative-ai"
import { extractJsonObject } from "./geminiJsonExtract.js"
import { getGeminiModelCandidates } from "./geminiModel.js"
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

function stringifyField(v) {
  if (typeof v === "string") return v.trim()
  if (v == null) return ""
  return String(v).trim()
}

/** Gemini sometimes uses alternate key casing or camelCase. */
function normalizePolishShape(parsed) {
  if (!parsed || typeof parsed !== "object") return null
  return {
    reason: parsed.reason ?? parsed.Reason ?? parsed.summary,
    future_impact:
      parsed.future_impact ??
      parsed.futureImpact ??
      parsed.Future_impact ??
      parsed["future impact"],
    tradeoffs: parsed.tradeoffs ?? parsed.Tradeoffs,
    selected_task_id:
      parsed.selected_task_id ?? parsed.selectedTaskId ?? parsed.selectedtask_id,
  }
}

/** Slim ORBIT context for Gemini — full ranked list was bloating prompts and breaking JSON replies. */
function buildNarrativeBrief(payload) {
  const ranked = Array.isArray(payload.orbit?.ranked) ? payload.orbit.ranked : []
  const recv = payload.debug?.received ?? {}
  const top3 = payload.candidates_top_3 ?? ranked.slice(0, 3) ?? []
  const top0 = ranked[0] ?? null

  const actionTrim =
    typeof payload.action === "string" && payload.action.trim().length > 0
      ? payload.action.trim()
      : ""
  const recommended_action =
    actionTrim ||
    (top0?.title
      ? `Focus first on: ${String(top0.title).slice(0, 120)} (top ORBIT ranked task)`
      : "Use candidates_top_3[0] as the default primary task.")

  const mem = payload.debug?.received?.memory
  const recentRuns = Array.isArray(mem?.recentRuns) ? mem.recentRuns.slice(0, 5) : []

  const slimRow = (r) => {
    if (!r || typeof r !== "object") return r
    return {
      id: r.id,
      title: typeof r.title === "string" ? r.title.slice(0, 140) : r.title,
      orbitScore: r.orbitScore,
      urgency: r.urgency,
      goalAlignment: r.goalAlignment,
      feasibility: r.feasibility,
      riskReduction: r.riskReduction,
      estimatedMinutes: r.estimatedMinutes,
    }
  }

  let rankedSlice = ranked.slice(0, 12).map(slimRow)
  let briefObj = {
    mode: payload.mode ?? null,
    recommended_action: recommended_action.slice(0, 500),
    user_short_term_goals: String(recv.shortTermGoals ?? "").slice(0, 220),
    user_long_term_goals: String(recv.longTermGoals ?? "").slice(0, 560),
    deterministic_reason: String(payload.reason ?? "").slice(0, 1200),
    deterministic_risk: String(payload.risk ?? "").slice(0, 2000),
    deterministic_future_impact: String(payload.future_impact ?? "").slice(0, 1200),
    confidence_percent: payload.confidence,
    confidence_breakdown: payload.confidence_breakdown ?? null,
    top_ranked_task: top0 ? slimRow(top0) : null,
    ranked_tasks: rankedSlice,
    candidates_top_3: top3.map(slimRow),
    candidate_ids_allowed: top3.map((t) => t?.id).filter(Boolean),
    alternatives: (payload.alternatives ?? []).slice(0, 3),
    user_model_summary:
      typeof payload.userModel?.summary === "string"
        ? payload.userModel.summary.slice(0, 700)
        : payload.userModel?.summary ?? null,
    behavior_profile: payload.userModel?.behavior_profile ?? null,
    sentinel_by_candidate: (payload.sentinel_by_candidate ?? []).slice(0, 4),
    sentinel: payload.sentinel ?? null,
    session_memory_recent: recentRuns,
  }

  let json = JSON.stringify(briefObj)
  while (json.length > 24_000 && rankedSlice.length > 4) {
    rankedSlice = ranked.slice(0, rankedSlice.length - 2).map(slimRow)
    briefObj = { ...briefObj, ranked_tasks: rankedSlice }
    json = JSON.stringify(briefObj)
  }
  return json
}

/** reason + future_impact must be at least `minRf` chars (model sometimes returns short fragments). */
function buildPolishFromParsed(parsed, payload, candidateIds, minRf = 4) {
  const norm = normalizePolishShape(parsed)
  if (!norm) return null
  const r = stringifyField(norm.reason)
  const f = stringifyField(norm.future_impact)
  if (r.length < minRf || f.length < minRf) return null

  let tradeoffs = stringifyField(norm.tradeoffs)
  if (tradeoffs.length < 12) {
    tradeoffs = String(payload.tradeoffs ?? "").trim()
  }
  tradeoffs = tradeoffs.slice(0, 1500)

  let selected_task_id = null
  const sel = norm.selected_task_id
  if (typeof sel === "string") {
    const t = sel.trim()
    if (candidateIds.includes(t)) selected_task_id = t
  } else if (sel === null || sel === undefined) {
    selected_task_id = null
  }

  return {
    reason: r.slice(0, 2000),
    future_impact: f.slice(0, 2000),
    tradeoffs,
    selected_task_id,
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
    return {
      reason: String(payload.reason ?? "").slice(0, 2000),
      future_impact: String(payload.future_impact ?? "").slice(0, 2000),
      tradeoffs: String(payload.tradeoffs ?? "").trim().slice(0, 1500),
      selected_task_id: null,
      modelId: "deterministic-fallback",
      _llmNotes: "no GEMINI_API_KEY",
    }
  }

  const modelCandidates = getGeminiModelCandidates()
  const timeoutMs = Math.max(
    3000,
    Math.min(60_000, Number(process.env.GEMINI_TIMEOUT_MS) || 14_000),
  )

  const genAI = new GoogleGenerativeAI(apiKey)
  const generationConfig = {
    maxOutputTokens: 2048,
    temperature: 0.28,
  }

  const top3 =
    payload.candidates_top_3 ?? payload.orbit?.ranked?.slice(0, 3) ?? []
  const candidateIds = top3.map((t) => t.id).filter(Boolean)

  const brief = buildNarrativeBrief(payload)

  const prompt = `You are ORBIT's narrative layer for a personal life dashboard: one place where a student (or busy builder) sees goals, energy, time budget, ranked tasks, schedule blocks, and risk-style signals—explained in plain language.

The JSON below was produced by deterministic ORBIT Core (fixed math + rules). Treat those facts as ground truth.

Strict rules:
- You MUST NOT contradict recommended_action or imply a different primary task for *right now*. Do not name a runner-up as the thing to do now; use tradeoffs only to compare #1 vs #2 vs #3.
- candidate_ids_allowed lists the ONLY task ids you may output as selected_task_id. Output selected_task_id as EXACTLY one of those ids, OR null to keep the default (#1 in candidates_top_3). Never pick outside that list.
- When user_short_term_goals / user_long_term_goals are non-empty, tie reason and future_impact to them only where it honestly fits the ranked task and scores—no empty cheerleading.
- If session_memory_recent or behavior_profile is non-empty, reference briefly for tone—never invent events not implied by the JSON.
- Mirror urgency / goal-fit / workload using language already implied by deterministic_reason, deterministic_risk, and deterministic_future_impact—do not invent new percentages or metrics not present in the JSON.
- Keep reason and future_impact under 650 characters each; tradeoffs 140–550 characters.

Fields (output shape is fixed):
- reason: why this ONE primary focus now (deadline pressure, fit to goals, time/mood realism).
- future_impact: next 24–72h upside of acting vs letting the stack compound.
- tradeoffs: compare #1 vs #2 vs #3 on urgency/goal/feasibility/risk-style scores from the JSON.
- selected_task_id: one of candidate_ids_allowed, or null.

Output ONLY valid JSON (no markdown fences, no text before or after the object):
{"reason":"...","future_impact":"...","tradeoffs":"...","selected_task_id":"task_0"}

INPUT:
${brief}`

  const repairPrompt = `Your previous reply was not usable: we need ONE JSON object only.

Rules:
- Keys exactly: reason, future_impact, tradeoffs, selected_task_id
- reason: string, at least 40 characters (why focus on the top task now).
- future_impact: string, at least 40 characters (next 24–72h if they act).
- tradeoffs: string, at least 60 characters (compare #1 vs #2 vs #3).
- selected_task_id: must be exactly one of these strings, or null: ${JSON.stringify(candidateIds)}

No markdown fences. No commentary outside JSON.

INPUT:
${brief.length > 14_000 ? `${brief.slice(0, 14_000)}\n…(truncated)` : brief}`

  /** ORBIT Core already produced reason/future_impact/tradeoffs — never fail the HTTP route for narrative. */
  const deterministicReturn = (note) => ({
    reason: String(payload.reason ?? "").slice(0, 2000),
    future_impact: String(payload.future_impact ?? "").slice(0, 2000),
    tradeoffs: String(payload.tradeoffs ?? "").trim().slice(0, 1500),
    selected_task_id: null,
    modelId: "deterministic-fallback",
    _llmNotes: note,
  })

  let lastFailNote = ""
  for (let i = 0; i < modelCandidates.length; i++) {
    const modelId = modelCandidates[i]
    const model = genAI.getGenerativeModel({ model: modelId, generationConfig })
    try {
      const ask = async (userPrompt) => {
        const result = await raceWithTimeout(timeoutMs, () => model.generateContent(userPrompt))
        let text
        try {
          text = result.response.text()
        } catch (e) {
          throw new Error(`Gemini response had no text: ${e?.message ?? String(e)}`)
        }
        return extractJsonObject(text)
      }

      let parsed = await ask(prompt)
      let out = buildPolishFromParsed(parsed, payload, candidateIds, 4)
      if (!out) {
        parsed = await ask(repairPrompt)
        out = buildPolishFromParsed(parsed, payload, candidateIds, 4)
      }

      if (!out) {
        lastFailNote = `${modelId}: not valid JSON with reason/future_impact after repair`
        console.warn(`[ORBIT] ${lastFailNote}`)
        if (i < modelCandidates.length - 1) continue
        return deterministicReturn(lastFailNote)
      }

      return { ...out, modelId }
    } catch (err) {
      if (err instanceof GeminiConfigurationError) {
        throw err
      }
      lastFailNote = `${modelId}: ${err?.message ?? String(err)}`
      console.warn(`[ORBIT] Gemini narrative (${modelId}):`, err?.message ?? err)
      if (i < modelCandidates.length - 1) {
        continue
      }
    }
  }
  return deterministicReturn(lastFailNote || "all Gemini narrative candidates exhausted")
}
