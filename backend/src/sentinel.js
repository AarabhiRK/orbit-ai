import { DEFER_HOURS, DEFER_HOURS_LONG } from "./constants.js"
import { scoreTasks, urgencyForTask } from "./scoring.js"

function meanUrgencyForTasks(tasks, asOfIso) {
  if (tasks.length === 0) return 0
  return tasks.reduce((s, t) => s + urgencyForTask(t, asOfIso), 0) / tasks.length
}

function meanUrgencyAfterDefer(tasks, chosenTaskId, asOfMs, deferHours) {
  if (tasks.length === 0) return 0
  const baseIso = new Date(asOfMs).toISOString()
  const deferIso = new Date(asOfMs + deferHours * 60 * 60 * 1000).toISOString()
  return (
    tasks.reduce((s, t) => {
      const iso = t.id === chosenTaskId ? deferIso : baseIso
      return s + urgencyForTask(t, iso)
    }, 0) / tasks.length
  )
}

function countDeadlineCollisionsSoon(tasks, asOfMs) {
  const asOfIso = new Date(asOfMs).toISOString()
  const horizonMs = asOfMs + DEFER_HOURS_LONG * 60 * 60 * 1000
  let c = 0
  for (const t of tasks) {
    if (!t.dueAt) continue
    const due = Date.parse(t.dueAt)
    if (Number.isNaN(due) || due > horizonMs) continue
    if (urgencyForTask(t, asOfIso) >= 0.78) c++
  }
  return c
}

function countTasksDueWithin72h(tasks, asOfMs) {
  const horizonMs = asOfMs + DEFER_HOURS_LONG * 60 * 60 * 1000
  let n = 0
  for (const t of tasks) {
    if (!t.dueAt) continue
    const due = Date.parse(t.dueAt)
    if (!Number.isNaN(due) && due <= horizonMs) n++
  }
  return n
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x))
}

/**
 * Structured Sentinel state (LOW / MEDIUM / HIGH + numeric proxy).
 * @param {object} s
 */
export function classifySentinelRiskState(s) {
  let pts = 0
  if (s.workloadRatio >= 1.45) pts += 2
  else if (s.workloadRatio >= 1.05) pts += 1
  if (s.meanUrgencyDelta >= 0.07) pts += 2
  else if (s.meanUrgencyDelta >= 0.025) pts += 1
  const d72 = s.meanUrgencyDelta72h ?? 0
  if (d72 >= 0.1) pts += 2
  else if (d72 >= 0.04) pts += 1
  const col = s.deadlineCollisionCount ?? 0
  if (col >= 2) pts += 2
  else if (col === 1) pts += 1
  if ((s.stressEscalationIndex ?? 0) >= 0.62) pts += 1

  const level = pts >= 5 ? "HIGH" : pts >= 2 ? "MEDIUM" : "LOW"
  const probabilityScore = Math.min(100, Math.round(22 + pts * 12 + s.workloadRatio * 7))
  return { level, probabilityScore, score_points: pts }
}

/**
 * Sentinel: defer chosen task 24h and 72h; workload; collision / stress proxies.
 */
export function sentinelDeferSnapshot({
  tasks,
  chosenTaskId,
  asOfMs,
  goalsRaw,
  timeAvailableMinutes,
  energy,
  weights,
}) {
  const asOfIso = new Date(asOfMs).toISOString()

  const rowsNow = scoreTasks(tasks, {
    asOfIso,
    goalsRaw,
    timeAvailableMinutes,
    energy,
    weights,
  })

  const meanNow = meanUrgencyForTasks(tasks, asOfIso)
  const meanUrgencyIfDeferChosen = meanUrgencyAfterDefer(
    tasks,
    chosenTaskId,
    asOfMs,
    DEFER_HOURS,
  )
  const meanUrgencyDelta = meanUrgencyIfDeferChosen - meanNow

  const meanUrgencyIfDefer72h = meanUrgencyAfterDefer(
    tasks,
    chosenTaskId,
    asOfMs,
    DEFER_HOURS_LONG,
  )
  const meanUrgencyDelta72h = meanUrgencyIfDefer72h - meanNow

  const totalMinutes = tasks.reduce((s, t) => s + Number(t.estimatedMinutes || 0), 0)
  const workloadRatio = totalMinutes / Math.max(1, timeAvailableMinutes)

  const top = rowsNow[0]
  const deadlineCollisionCount = countDeadlineCollisionsSoon(tasks, asOfMs)
  const tasksDueIn72h = countTasksDueWithin72h(tasks, asOfMs)
  const deadlineCollisionProbability =
    tasksDueIn72h > 0
      ? Math.min(1, deadlineCollisionCount / tasksDueIn72h)
      : 0
  const secondScore = rowsNow.length >= 2 ? rowsNow[1].orbitScore : top.orbitScore
  const opportunityCostImpact0_100 = Math.round(
    clamp((1 - secondScore / Math.max(0.0001, top.orbitScore)) * 100, 0, 100),
  )

  const stressEscalationIndex = clamp(
    (workloadRatio - 1) * 0.38 +
      meanUrgencyDelta * 2.9 +
      deadlineCollisionCount * 0.065 +
      Math.max(0, meanUrgencyDelta72h) * 1.2,
    0,
    1,
  )

  const allUndated =
    tasks.length > 0 && tasks.every((t) => t.dueAt == null)

  const base = {
    deferHours: DEFER_HOURS,
    deferHoursLong: DEFER_HOURS_LONG,
    meanUrgencyNow: meanNow,
    meanUrgencyIfDeferChosen,
    meanUrgencyDelta,
    meanUrgencyIfDefer72h,
    meanUrgencyDelta72h,
    workloadRatio,
    allUndated,
    deadlineCollisionCount,
    deadlineCollisionProbability: Math.round(deadlineCollisionProbability * 1000) / 1000,
    tasksDueIn72h,
    stressEscalationIndex,
    opportunityCostImpact0_100,
    opportunityCostTop2Gap:
      rowsNow.length >= 2 ? top.orbitScore - rowsNow[1].orbitScore : top.orbitScore,
    scoreGapTop2:
      rowsNow.length >= 2 ? top.orbitScore - rowsNow[1].orbitScore : top.orbitScore,
  }

  const riskState = classifySentinelRiskState(base)
  return { ...base, riskLevel: riskState.level, riskProbabilityScore: riskState.probabilityScore }
}

/**
 * Full Sentinel run for each of the top 3 ranked tasks (same backlog model).
 */
export function sentinelSnapshotsForTopThree(
  tasks,
  rows,
  asOfMs,
  goalsRaw,
  timeAvailableMinutes,
  energy,
  weights,
) {
  const out = []
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const r = rows[i]
    const snap = sentinelDeferSnapshot({
      tasks,
      chosenTaskId: r.task.id,
      asOfMs,
      goalsRaw,
      timeAvailableMinutes,
      energy,
      weights,
    })
    out.push({
      rank: i + 1,
      taskId: r.task.id,
      title: r.task.title,
      orbitScore: r.orbitScore,
      sentinel: snap,
    })
  }
  return out
}

/** @param {object[]} [memoryRecent] */
export function formatSentinelRiskLine(s, memoryRecent = []) {
  const pctNow = Math.min(100, Math.max(0, Math.round(s.meanUrgencyNow * 100)))
  const pctDefer = Math.min(
    100,
    Math.max(0, Math.round(s.meanUrgencyIfDeferChosen * 100)),
  )
  const pct72 = Math.min(
    100,
    Math.max(0, Math.round((s.meanUrgencyIfDefer72h ?? s.meanUrgencyNow) * 100)),
  )
  const line1 = `Backlog urgency index: ${pctNow}% now → ${pctDefer}% if you defer the top pick ${s.deferHours}h (→ ${pct72}% index at ${s.deferHoursLong ?? 72}h defer).`

  const pctDelta = (s.meanUrgencyDelta * 100).toFixed(1)
  const pctDelta72 = ((s.meanUrgencyDelta72h ?? 0) * 100).toFixed(1)
  const load = s.workloadRatio.toFixed(2)
  const sign = s.meanUrgencyDelta >= 0 ? "+" : ""
  const sign72 = (s.meanUrgencyDelta72h ?? 0) >= 0 ? "+" : ""
  const line2 = `Mean urgency delta: ${sign}${pctDelta} pts @ ${s.deferHours}h, ${sign72}${pctDelta72} pts @ ${s.deferHoursLong ?? 72}h; workload vs available time: ${load}×.`

  const lineRisk = `Structured risk: ${s.riskLevel ?? "UNKNOWN"} (model score ${s.riskProbabilityScore ?? "—"}/100); deadline collision proxy: ${s.deadlineCollisionCount ?? 0} / ${s.tasksDueIn72h ?? 0} due in 72h → P≈${((s.deadlineCollisionProbability ?? 0) * 100).toFixed(0)}%; stress index: ${((s.stressEscalationIndex ?? 0) * 100).toFixed(0)}%; opportunity-cost index: ${s.opportunityCostImpact0_100 ?? "—"}/100 (gap #1 vs #2).`

  let undatedTip = ""
  if (s.allUndated) {
    undatedTip =
      "\nTip: No due: dates on your tasks, so urgency uses the same baseline for every line — deferring often leaves the index unchanged. Add optional due:YYYY-MM-DD on a line to model real deadline pressure."
  }

  let mem = ""
  if (Array.isArray(memoryRecent) && memoryRecent.length > 0) {
    const bits = memoryRecent.slice(0, 4).map((r, i) => {
      const label = r.topTitle || r.action || "—"
      return `${i + 1}) ${String(label).slice(0, 48)}`
    })
    mem = `\nSession memory (recent picks): ${bits.join("; ")}.`
  }

  return `${line1}\n${line2}\n${lineRisk}${undatedTip}${mem}`
}
