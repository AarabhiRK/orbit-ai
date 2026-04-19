function round4(n) {
  return Math.round(n * 10_000) / 10_000
}

export function toScore100(x) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  return Math.round(clamp(x, 0, 1) * 100)
}

/**
 * @param {{ task: object, urgency: number, goalAlignment: number, feasibility: number, riskReduction: number, orbitScore: number }} r
 */
export function mapRankedRow(r) {
  return {
    id: r.task.id,
    title: r.task.title,
    dueAt: r.task.dueAt,
    estimatedMinutes: r.task.estimatedMinutes,
    estProvided: Boolean(r.task.estProvided),
    dependency: r.task.dependsOn ?? null,
    urgency: round4(r.urgency),
    goalAlignment: round4(r.goalAlignment),
    feasibility: round4(r.feasibility),
    riskReduction: round4(r.riskReduction),
    orbitScore: round4(r.orbitScore),
    urgency_0_100: toScore100(r.urgency),
    goal_alignment_0_100: toScore100(r.goalAlignment),
    feasibility_0_100: toScore100(r.feasibility),
    risk_reduction_0_100: toScore100(r.riskReduction),
  }
}
