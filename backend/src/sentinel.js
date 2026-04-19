import { DEFER_HOURS } from "./constants.js"
import { scoreTasks, urgencyForTask } from "./scoring.js"

/**
 * Sentinel (minimal): if you defer only the recommended task by DEFER_HOURS,
 * how much does mean urgency across the backlog move, and what is workload vs capacity?
 */
export function sentinelDeferSnapshot({
  tasks,
  chosenTaskId,
  asOfMs,
  goalsRaw,
  timeAvailableMinutes,
  energy,
}) {
  const asOfIso = new Date(asOfMs).toISOString()
  const deferAsOfIso = new Date(asOfMs + DEFER_HOURS * 60 * 60 * 1000).toISOString()

  const rowsNow = scoreTasks(tasks, {
    asOfIso,
    goalsRaw,
    timeAvailableMinutes,
    energy,
  })

  const meanUrgency = (list) =>
    list.length === 0
      ? 0
      : list.reduce((s, t) => s + urgencyForTask(t, asOfIso), 0) / list.length

  const meanUrgencyAfterDefer =
    tasks.length === 0
      ? 0
      : tasks.reduce((s, t) => {
          const iso = t.id === chosenTaskId ? deferAsOfIso : asOfIso
          return s + urgencyForTask(t, iso)
        }, 0) / tasks.length

  const totalMinutes = tasks.reduce((s, t) => s + Number(t.estimatedMinutes || 0), 0)
  const workloadRatio = totalMinutes / Math.max(1, timeAvailableMinutes)

  const top = rowsNow[0]
  const deltaMeanUrgency = meanUrgencyAfterDefer - meanUrgency(tasks)

  return {
    deferHours: DEFER_HOURS,
    meanUrgencyNow: meanUrgency(tasks),
    meanUrgencyIfDeferChosen: meanUrgencyAfterDefer,
    meanUrgencyDelta: deltaMeanUrgency,
    workloadRatio,
    scoreGapTop2:
      rowsNow.length >= 2 ? top.orbitScore - rowsNow[1].orbitScore : top.orbitScore,
  }
}

export function formatSentinelRiskLine(s) {
  const pctDelta = (s.meanUrgencyDelta * 100).toFixed(1)
  const load = s.workloadRatio.toFixed(2)
  const sign = s.meanUrgencyDelta >= 0 ? "+" : ""
  return `Deferring the top pick by ${s.deferHours}h raises mean backlog urgency by ${sign}${pctDelta} pts (index); workload vs time is ${load}×.`
}
