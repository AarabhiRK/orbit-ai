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

export function orbitScore(urgency, goalAlignment, feasibility) {
  return (
    ORBIT_WEIGHTS.urgency * urgency +
    ORBIT_WEIGHTS.goalAlignment * goalAlignment +
    ORBIT_WEIGHTS.feasibility * feasibility
  )
}

/**
 * @returns {{ task: object, urgency: number, goalAlignment: number, feasibility: number, orbitScore: number }[]}
 */
export function scoreTasks(tasks, { asOfIso, goalsRaw, timeAvailableMinutes, energy }) {
  const rows = tasks.map((task) => {
    const urgency = urgencyForTask(task, asOfIso)
    const goalAlignment = goalAlignmentForTask(task, goalsRaw)
    const feasibility = feasibilityForTask(task, timeAvailableMinutes, energy)
    const score = orbitScore(urgency, goalAlignment, feasibility)
    return { task, urgency, goalAlignment, feasibility, orbitScore: score }
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
  const pct = Math.round(clamp(raw, 0.52, 0.97) * 100)
  return pct
}
