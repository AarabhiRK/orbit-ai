/**
 * Client-supplied outcome history (localStorage). Sanitized; not used for auth.
 *
 * @param {unknown} raw
 * @returns {{ at: string, topTitle: string, outcome: "done"|"ignored" }[]}
 */
export function sanitizeBehaviorOutcomes(raw) {
  if (!raw || typeof raw !== "object") return []
  const arr = Array.isArray(raw.outcomes) ? raw.outcomes : []
  const out = []
  for (const e of arr.slice(0, 40)) {
    if (!e || typeof e !== "object") continue
    const oc = e.outcome
    if (oc !== "done" && oc !== "ignored") continue
    const topTitle =
      typeof e.topTitle === "string" ? e.topTitle.slice(0, 220) : ""
    const at = typeof e.at === "string" ? e.at.slice(0, 40) : ""
    if (!topTitle) continue
    out.push({ at, topTitle, outcome: oc })
  }
  return out.slice(0, 30)
}

/**
 * @param {object[]} memoryRecent — sanitized recentRuns
 * @param {ReturnType<sanitizeBehaviorOutcomes>} outcomes
 */
export function buildBehaviorProfileSnapshot(memoryRecent, outcomes) {
  const done = outcomes.filter((o) => o.outcome === "done").length
  const ignored = outcomes.filter((o) => o.outcome === "ignored").length
  const denom = done + ignored
  const completion_rate = denom > 0 ? Math.round((done / denom) * 1000) / 1000 : null

  const titleCounts = {}
  for (const r of memoryRecent) {
    const k = (r.topTitle || "").trim()
    if (!k) continue
    titleCounts[k] = (titleCounts[k] || 0) + 1
  }
  const repeatTitles = Object.entries(titleCounts).filter(([, c]) => c >= 2)
  const procrastination_proxy =
    Math.min(
      1,
      repeatTitles.length * 0.15 + (denom > 0 ? (ignored / denom) * 0.5 : 0),
    )

  const scores = memoryRecent
    .map((r) => Number(r.orbitScoreTop))
    .filter((n) => Number.isFinite(n))
  const focus_pattern_hint =
    scores.length === 0
      ? "insufficient_history"
      : scores.length < 3
        ? "early_session"
        : "stable"

  const ignored_recommendations_count = ignored

  let focus_duration_pattern_score_0_100 = 50
  if (scores.length >= 4) {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const variance =
      scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
    focus_duration_pattern_score_0_100 = Math.round(
      Math.min(1, Math.sqrt(variance) * 5) * 100,
    )
  } else if (scores.length >= 2) {
    focus_duration_pattern_score_0_100 = 62
  }

  return {
    procrastination_tendency_proxy: Math.round(procrastination_proxy * 1000) / 1000,
    procrastination_tendency_0_100: Math.round(procrastination_proxy * 100),
    completion_rate,
    completion_rate_0_100:
      completion_rate == null ? null : Math.round(completion_rate * 100),
    focus_pattern_hint,
    focus_duration_pattern_score_0_100,
    ignored_recommendations_count,
    outcome_events_recorded: outcomes.length,
    session_runs_considered: memoryRecent.length,
    notes:
      "Proxies from browser memory only (no server DB). completion_rate needs Done/Ignored taps.",
  }
}
