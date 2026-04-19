import {
  ENERGY_EFFECTIVE_TIME,
  NO_DEADLINE_URGENCY,
  ORBIT_WEIGHTS,
  SLACK_NORMALIZATION_MINUTES,
} from "./constants.js"
import { jaccard, uniqueTokenSet } from "./textUtils.js"

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x))
}

export function urgencyForTask(task, asOfIso) {
  const asOfMs = Date.parse(asOfIso)
  if (Number.isNaN(asOfMs)) throw new Error(`Invalid asOf: ${asOfIso}`)

  if (task.dueAt == null) return NO_DEADLINE_URGENCY

  const dueMs = Date.parse(task.dueAt)
  if (Number.isNaN(dueMs)) throw new Error(`Invalid dueAt for ${task.id}`)

  const minutesUntilDue = (dueMs - asOfMs) / 60_000
  const slackMinutes = minutesUntilDue - Number(task.estimatedMinutes ?? 0)

  if (slackMinutes <= 0) return 1

  return clamp(1 - slackMinutes / SLACK_NORMALIZATION_MINUTES, 0, 1)
}

export function goalAlignmentForTask(task, goalsRaw) {
  const goalTokens = uniqueTokenSet([goalsRaw])
  const taskTokens = uniqueTokenSet([task.title])
  return clamp(jaccard(goalTokens, taskTokens), 0, 1)
}

export function feasibilityForTask(task, timeAvailableMinutes, energy) {
  const factor = ENERGY_EFFECTIVE_TIME[energy] ?? ENERGY_EFFECTIVE_TIME.medium
  const effectiveMinutes = timeAvailableMinutes * factor
  const est = Number(task.estimatedMinutes)
  if (!Number.isFinite(est) || est <= 0) {
    throw new Error(`Task ${task.id}: invalid estimatedMinutes`)
  }
  return clamp(effectiveMinutes / est, 0, 1)
}

/**
 * “Risk reduction” — doing this task now lowers exposure when it is urgent and/or
 * it clears a meaningful share of an overloaded backlog (transparent heuristic).
 */
export function riskReductionForTask(task, asOfIso, tasks, timeAvailableMinutes) {
  const u = urgencyForTask(task, asOfIso)
  const totalEst = tasks.reduce(
    (s, t) => s + Math.max(1, Math.round(Number(t.estimatedMinutes) || 1)),
    0,
  )
  const myEst = Math.max(1, Math.round(Number(task.estimatedMinutes) || 1))
  const share = myEst / Math.max(1, totalEst)
  const backlogPressure = clamp(totalEst / Math.max(30, timeAvailableMinutes), 0, 3) / 3
  const relief = share * (0.45 + 0.55 * backlogPressure)
  return clamp(0.55 * u + 0.45 * relief, 0, 1)
}

export function orbitScore(urgency, goalAlignment, feasibility, riskReduction, w = ORBIT_WEIGHTS) {
  return (
    w.urgency * urgency +
    w.goalAlignment * goalAlignment +
    w.feasibility * feasibility +
    w.riskReduction * riskReduction
  )
}

/**
 * @returns {{ task: object, urgency: number, goalAlignment: number, feasibility: number, riskReduction: number, orbitScore: number }[]}
 */
export function scoreTasks(tasks, { asOfIso, goalsRaw, timeAvailableMinutes, energy, weights }) {
  const w = weights ?? ORBIT_WEIGHTS
  const rows = tasks.map((task) => {
    const urgency = urgencyForTask(task, asOfIso)
    const goalAlignment = goalAlignmentForTask(task, goalsRaw)
    const feasibility = feasibilityForTask(task, timeAvailableMinutes, energy)
    const riskReduction = riskReductionForTask(
      task,
      asOfIso,
      tasks,
      timeAvailableMinutes,
    )
    const score = orbitScore(urgency, goalAlignment, feasibility, riskReduction, w)
    return {
      task,
      urgency,
      goalAlignment,
      feasibility,
      riskReduction,
      orbitScore: score,
    }
  })

  rows.sort((a, b) => {
    if (b.orbitScore !== a.orbitScore) return b.orbitScore - a.orbitScore
    return String(a.task.id).localeCompare(String(b.task.id))
  })

  return rows
}

export function confidencePercent(top, second) {
  const margin = top.orbitScore - (second?.orbitScore ?? 0)
  const raw = 0.55 + margin * 4.2
  return Math.round(clamp(raw, 0.52, 0.97) * 100)
}

/**
 * @param {"LOW"|"MEDIUM"|"HIGH"} sentinelRiskLevel
 */
export function confidenceBreakdown(top, second, ctx) {
  const margin = top.orbitScore - (second?.orbitScore ?? 0)
  const decisionStability = clamp(0.38 + margin * 6.5, 0, 1)
  const dataConfidence = clamp(
    0.32 + 0.38 * ctx.estProvidedRatio + 0.3 * ctx.datedRatio,
    0,
    1,
  )
  let riskUncertainty = 0.72
  if (ctx.sentinelRiskLevel === "HIGH") riskUncertainty = 0.42
  else if (ctx.sentinelRiskLevel === "MEDIUM") riskUncertainty = 0.58
  else if (ctx.sentinelRiskLevel === "LOW") riskUncertainty = 0.82

  const blend =
    0.34 * dataConfidence + 0.44 * decisionStability + 0.22 * riskUncertainty
  const composite_percent = Math.round(clamp(blend, 0.52, 0.97) * 100)
  return {
    data_confidence: Math.round(dataConfidence * 1000) / 1000,
    decision_stability: Math.round(decisionStability * 1000) / 1000,
    risk_uncertainty: Math.round(riskUncertainty * 1000) / 1000,
    composite_percent,
    headline_margin_percent: confidencePercent(top, second),
  }
}

/**
 * Drop very low-priority tails before packing (still returned in `discarded` for audit).
 */
export function partitionScheduleRows(rows) {
  if (rows.length === 0) return { eligible: [], discarded: [] }
  const top = rows[0].orbitScore
  const floor = Math.max(0.1, top * 0.4)
  const eligible = []
  const discarded = []
  for (const r of rows) {
    if (r.orbitScore >= floor) eligible.push(r)
    else
      discarded.push({
        id: r.task.id,
        title: r.task.title,
        orbitScore: r.orbitScore,
        floor,
      })
  }
  if (eligible.length === 0) eligible.push(rows[0])
  return { eligible, discarded }
}
