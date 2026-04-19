import { buildBehaviorProfileSnapshot } from "./behaviorMemory.js"
import { parseGenerateBody } from "./parseBody.js"
import { normalizeTasksFromLines, taskStringsFromRaw } from "./normalizeTasks.js"
import { mapRankedRow } from "./orbitPayloadMappers.js"
import { confidenceBreakdown, scoreTasks } from "./scoring.js"
import {
  formatSentinelRiskLine,
  sentinelSnapshotsForTopThree,
} from "./sentinel.js"
import { polishOrbitNarrative } from "./geminiNarrative.js"
import { inferUserProfile } from "./agents/userProfileAgent.js"
import { buildDeterministicTradeoffs } from "./tradeoffsText.js"

function round4(n) {
  return Math.round(n * 10_000) / 10_000
}

function buildSteps(task) {
  const est = Math.max(5, Math.min(task.estimatedMinutes, 180))
  const first = Math.min(25, est)
  return [
    `Time-box ${first} minutes; single concrete output only`,
    `Work only on: ${task.title.slice(0, 80)}${task.title.length > 80 ? "…" : ""}`,
    `Stop when the timer ends; reschedule remainder if needed`,
  ]
}

function pickChosenRow(rows, selectedId) {
  const top3 = rows.slice(0, 3)
  if (selectedId && top3.some((r) => r.task.id === selectedId)) {
    return top3.find((r) => r.task.id === selectedId)
  }
  return rows[0]
}

function runnerUpFor(rows, chosen) {
  const others = rows.filter((r) => r.task.id !== chosen.task.id)
  others.sort((a, b) => b.orbitScore - a.orbitScore)
  return others[0] ?? chosen
}

/**
 * @param {Record<string, unknown>} body
 */
export async function generateNextAction(body) {
  const parsed = parseGenerateBody(body)
  const lines = taskStringsFromRaw(parsed.tasksRaw)

  const tasks = normalizeTasksFromLines(lines)
  const asOfMs = parsed.asOfIso ? Date.parse(parsed.asOfIso) : Date.now()
  const asOfIso = new Date(asOfMs).toISOString()
  const weights = parsed.orbitWeights

  const behaviorSnapshot = buildBehaviorProfileSnapshot(
    parsed.memoryRecent,
    parsed.behaviorOutcomes,
  )

  const userModel = inferUserProfile({
    tasks,
    goalsRaw: parsed.goalsRaw,
    mood: body.mood,
    memoryRecent: parsed.memoryRecent,
    energy: parsed.energy,
    behaviorSnapshot,
  })

  const rows = scoreTasks(tasks, {
    asOfIso,
    goalsRaw: parsed.goalsRaw,
    timeAvailableMinutes: parsed.timeAvailableMinutes,
    energy: parsed.energy,
    weights,
  })

  const sentinelByCandidate = sentinelSnapshotsForTopThree(
    tasks,
    rows,
    asOfMs,
    parsed.goalsRaw,
    parsed.timeAvailableMinutes,
    parsed.energy,
    weights,
  )

  const tradeoffsDeterministic = buildDeterministicTradeoffs(rows.slice(0, 3))
  const primarySnap = sentinelByCandidate[0]?.sentinel

  const estProvidedRatio =
    tasks.filter((t) => t.estProvided).length / Math.max(1, tasks.length)
  const datedRatio =
    tasks.filter((t) => t.dueAt != null).length / Math.max(1, tasks.length)

  let chosen = rows[0]
  let chosenSnap = primarySnap

  const reason0 = `ORBIT ranked tasks; weights ${JSON.stringify(weights)} on 0–1 subscores (see orbit.ranked *_0_100); energy ${parsed.energy}.`
  const future0 =
    primarySnap.workloadRatio > 1
      ? `Clearing #1 now reduces pressure vs a ${primarySnap.workloadRatio.toFixed(2)}× workload-to-time stack.`
      : `Completing #1 now keeps slack above a ${(1 / Math.max(primarySnap.workloadRatio, 0.01)).toFixed(2)}× buffer vs total estimates.`

  const payload = {
    mode: "single_next_action",
    action: "",
    steps: [],
    reason: reason0,
    risk: formatSentinelRiskLine(primarySnap, parsed.memoryRecent),
    future_impact: future0,
    confidence: 0,
    confidence_margin_percent: 0,
    confidence_breakdown: {
      data_confidence: 0,
      decision_stability: 0,
      risk_uncertainty: 0,
      note: "Composite uses data quality (estimates/due dates), top-vs-runner-up stability, and Sentinel risk band.",
    },
    userModel,
    candidates_top_3: rows.slice(0, 3).map(mapRankedRow),
    alternatives: rows.slice(1, 3).map((r) => ({
      id: r.task.id,
      title: r.task.title,
      orbitScore: round4(r.orbitScore),
      one_line: `Score ${round4(r.orbitScore)} — urgency ${round4(r.urgency)}, goals ${round4(r.goalAlignment)}, feas. ${round4(r.feasibility)}, risk-red. ${round4(r.riskReduction)}`,
    })),
    sentinel_by_candidate: sentinelByCandidate.map((e) => ({
      rank: e.rank,
      taskId: e.taskId,
      title: e.title,
      orbitScore: round4(e.orbitScore),
      sentinel: {
        riskLevel: e.sentinel.riskLevel,
        riskProbabilityScore: e.sentinel.riskProbabilityScore,
        workloadRatio: round4(e.sentinel.workloadRatio),
        deadlineCollisionProbability: e.sentinel.deadlineCollisionProbability,
        opportunityCostImpact0_100: e.sentinel.opportunityCostImpact0_100,
        stressEscalationIndex: round4(e.sentinel.stressEscalationIndex),
      },
    })),
    tradeoffs: tradeoffsDeterministic,
    llm_selected_task_id: null,
    orbit: {
      asOf: asOfIso,
      weights: { ...weights },
      ranked: rows.map(mapRankedRow),
    },
    sentinel: null,
    debug: {
      received: {
        tasks: body.tasks,
        mood: body.mood,
        time: body.time,
        hours: body.hours ?? body.hoursAvailable,
        goals: body.goals,
        shortTermGoals: body.shortTermGoals,
        longTermGoals: body.longTermGoals,
        memory: { recentRuns: parsed.memoryRecent },
        behavior: { outcomes: parsed.behaviorOutcomes },
        policy: body.policy ?? null,
        durationHints: body.durationHints ?? null,
        asOf: body.asOf,
      },
      system: "orbit-core",
    },
  }

  const polished = await polishOrbitNarrative(payload)
  const usedGemini = polished.modelId !== "deterministic-fallback"
  payload.debug = {
    ...payload.debug,
    narrative_source: usedGemini ? "gemini" : "deterministic_fallback",
    llm: usedGemini
      ? { provider: "gemini", model: polished.modelId, ok: true }
      : {
          provider: "gemini",
          model: polished.modelId,
          ok: false,
          error: polished._llmNotes ?? "narrative_unavailable",
        },
  }
  payload.reason = polished.reason
  payload.future_impact = polished.future_impact
  payload.tradeoffs =
    polished.tradeoffs && polished.tradeoffs.trim().length >= 20
      ? polished.tradeoffs
      : tradeoffsDeterministic
  if (polished.selected_task_id) {
    chosen = pickChosenRow(rows, polished.selected_task_id)
    payload.llm_selected_task_id = polished.selected_task_id
    chosenSnap =
      sentinelByCandidate.find((s) => s.taskId === chosen.task.id)?.sentinel ??
      chosenSnap
  }

  const second = runnerUpFor(rows, chosen)
  const breakdown = confidenceBreakdown(chosen, second, {
    estProvidedRatio,
    datedRatio,
    sentinelRiskLevel: chosenSnap?.riskLevel ?? "MEDIUM",
  })
  payload.confidence = breakdown.composite_percent
  payload.confidence_margin_percent = breakdown.headline_margin_percent
  payload.confidence_breakdown = {
    data_confidence: breakdown.data_confidence,
    decision_stability: breakdown.decision_stability,
    risk_uncertainty: breakdown.risk_uncertainty,
    note: payload.confidence_breakdown.note,
  }

  const est = chosen.task.estimatedMinutes
  payload.action = `Start: ${chosen.task.title} (~${est} min)`
  payload.steps = buildSteps(chosen.task)

  payload.risk = formatSentinelRiskLine(chosenSnap, parsed.memoryRecent)
  if (sentinelByCandidate.length > 1) {
    const appendix = sentinelByCandidate
      .filter((e) => e.taskId !== chosen.task.id)
      .map(
        (e) =>
          `#${e.rank} ${e.title.slice(0, 48)}: ${e.sentinel.riskLevel} (model ${e.sentinel.riskProbabilityScore}/100; P_collision≈${((e.sentinel.deadlineCollisionProbability ?? 0) * 100).toFixed(0)}%)`,
      )
      .join("\n")
    payload.risk = `${payload.risk}\n\n--- Other top candidates (if not done) ---\n${appendix}`
  }

  payload.sentinel = {
    deferHours: chosenSnap.deferHours,
    deferHoursLong: chosenSnap.deferHoursLong,
    meanUrgencyNow: round4(chosenSnap.meanUrgencyNow),
    meanUrgencyIfDeferChosen: round4(chosenSnap.meanUrgencyIfDeferChosen),
    meanUrgencyDelta: round4(chosenSnap.meanUrgencyDelta),
    meanUrgencyIfDefer72h: round4(chosenSnap.meanUrgencyIfDefer72h),
    meanUrgencyDelta72h: round4(chosenSnap.meanUrgencyDelta72h),
    workloadRatio: round4(chosenSnap.workloadRatio),
    allUndated: chosenSnap.allUndated,
    scoreGapTop2: round4(chosenSnap.scoreGapTop2),
    riskLevel: chosenSnap.riskLevel,
    riskProbabilityScore: chosenSnap.riskProbabilityScore,
    deadlineCollisionCount: chosenSnap.deadlineCollisionCount,
    deadlineCollisionProbability: chosenSnap.deadlineCollisionProbability,
    tasksDueIn72h: chosenSnap.tasksDueIn72h,
    stressEscalationIndex: round4(chosenSnap.stressEscalationIndex),
    opportunityCostTop2Gap: round4(chosenSnap.opportunityCostTop2Gap),
    opportunityCostImpact0_100: chosenSnap.opportunityCostImpact0_100,
  }

  return payload
}
