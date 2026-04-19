/**
 * Dependency-aware ordering: rows whose task.dependsOn references another task
 * in the same list appear after that predecessor (Kahn on eligible ids).
 *
 * @param {{ task: { id: string, dependsOn?: string|null }, orbitScore: number }[]} rows
 */
export function sortRowsByDependencies(rows) {
  if (rows.length <= 1) return [...rows]
  const ids = new Set(rows.map((r) => r.task.id))
  const byId = new Map(rows.map((r) => [r.task.id, r]))

  const indeg = new Map()
  const adj = new Map()
  for (const id of ids) {
    indeg.set(id, 0)
    adj.set(id, [])
  }
  for (const r of rows) {
    const dep = r.task.dependsOn
    if (dep && ids.has(dep)) {
      indeg.set(r.task.id, (indeg.get(r.task.id) ?? 0) + 1)
      adj.get(dep).push(r.task.id)
    }
  }

  const q = []
  for (const [id, d] of indeg) if (d === 0) q.push(id)
  const topo = []
  while (q.length) {
    const id = q.shift()
    topo.push(id)
    for (const v of adj.get(id) ?? []) {
      indeg.set(v, indeg.get(v) - 1)
      if (indeg.get(v) === 0) q.push(v)
    }
  }
  if (topo.length !== rows.length) {
    return [...rows].sort((a, b) => b.orbitScore - a.orbitScore)
  }

  const orderIndex = new Map(topo.map((id, i) => [id, i]))
  return [...rows].sort((a, b) => {
      const ia = orderIndex.get(a.task.id) ?? 0
      const ib = orderIndex.get(b.task.id) ?? 0
      if (ia !== ib) return ia - ib
      return b.orbitScore - a.orbitScore
    })
}
