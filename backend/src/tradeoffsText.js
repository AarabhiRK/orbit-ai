/**
 * Deterministic tradeoff paragraph when LLM is unavailable.
 *
 * @param {{ task: { id: string, title: string }, orbitScore: number, urgency: number, goalAlignment: number, feasibility: number, riskReduction: number }[]} top3
 */
export function buildDeterministicTradeoffs(top3) {
  if (!top3?.length) return ""
  const lines = top3.map((r, i) => {
    const t = r.task.title.slice(0, 56)
    return `#${i + 1} ${t} — score ${r.orbitScore.toFixed(3)} (u ${r.urgency.toFixed(2)}, g ${r.goalAlignment.toFixed(2)}, f ${r.feasibility.toFixed(2)}, r ${r.riskReduction.toFixed(2)})`
  })
  return `Top three by ORBIT: ${lines.join(" | ")}. #1 wins on combined policy unless the reasoning agent selects another among these IDs.`
}
