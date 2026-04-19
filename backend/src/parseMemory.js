/**
 * Client-supplied session memory (e.g. from localStorage). Never trusted for auth;
 * only used for narrative context and light pattern hints.
 *
 * @param {unknown} raw
 * @returns {object[]}
 */
export function sanitizeMemoryRecent(raw) {
  if (!raw || typeof raw !== "object") return []
  const arr = Array.isArray(raw.recentRuns) ? raw.recentRuns : []
  const out = []
  for (const e of arr.slice(0, 8)) {
    if (!e || typeof e !== "object") continue
    const at = typeof e.at === "string" ? e.at.slice(0, 40) : ""
    const action = typeof e.action === "string" ? e.action.slice(0, 220) : ""
    const topTitle =
      typeof e.topTitle === "string" ? e.topTitle.slice(0, 220) : ""
    const n = Number(e.orbitScoreTop)
    const orbitScoreTop = Number.isFinite(n)
      ? Math.round(n * 10_000) / 10_000
      : null
    if (!at && !action && !topTitle && orbitScoreTop === null) continue
    out.push({ at, action, topTitle, orbitScoreTop })
  }
  return out
}
