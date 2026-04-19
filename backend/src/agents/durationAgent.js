/**
 * Predicts minutes when the user did not supply est: / Nmin on the task line.
 * Keyword rules are transparent (not a black-box model).
 * Optional `hints` (from client learning) override keywords when title matches pattern.
 */

const RULES = [
  { re: /\b(apply|application|intern|interview|linkedin|resume|network|recruit)\b/i, minutes: 45 },
  { re: /\b(email|inbox|dm|message|slack|discord)\b/i, minutes: 20 },
  { re: /\b(read|reading|book|chapter|paper|article)\b/i, minutes: 45 },
  { re: /\b(workout|gym|run|jog|yoga|lift|cardio)\b/i, minutes: 50 },
  { re: /\b(shower|brush|skincare)\b/i, minutes: 15 },
  { re: /\b(water|hydrat|fill\s+bottle)\b/i, minutes: 5 },
  { re: /\b(homework|pset|problem\s*set|assignment|essay|lab\s*report)\b/i, minutes: 75 },
  { re: /\b(clean|laundry|dishes|tidy|organize)\b/i, minutes: 35 },
  { re: /\b(meeting|call|zoom|standup)\b/i, minutes: 30 },
  { re: /\b(code|build|implement|debug|refactor|ship)\b/i, minutes: 90 },
  { re: /\b(study|exam|midterm|final|quiz)\b/i, minutes: 60 },
  { re: /\b(cook|meal|prep|grocery)\b/i, minutes: 40 },
  { re: /\b(commute|drive|transit)\b/i, minutes: 35 },
]

const DEFAULT_PREDICTED = 50

/**
 * @param {unknown} raw — body.durationHints
 * @returns {{ pattern: string, minutes: number }[]}
 */
export function sanitizeDurationHints(raw) {
  if (!raw || typeof raw !== "object") return []
  const arr = Array.isArray(raw.overrides)
    ? raw.overrides
    : Array.isArray(raw)
      ? raw
      : []
  const out = []
  for (const e of arr.slice(0, 24)) {
    if (!e || typeof e !== "object") continue
    const pattern =
      typeof e.pattern === "string" ? e.pattern.trim().slice(0, 80).toLowerCase() : ""
    const m = Number(e.minutes)
    if (!pattern || !Number.isFinite(m) || m < 1) continue
    out.push({ pattern, minutes: Math.round(m) })
  }
  return out
}

/**
 * @param {object[]} tasks — normalized tasks with `estProvided`
 * @param {{ pattern: string, minutes: number }[]} [hints]
 * @returns {{ tasks: object[], byTask: object[] }}
 */
export function applyDurationPredictions(tasks, hints = []) {
  const byTask = []
  const out = tasks.map((t) => {
    if (t.estProvided) {
      byTask.push({
        id: t.id,
        title: t.title,
        minutes: t.estimatedMinutes,
        source: "user_line",
      })
      return t
    }
    const title = String(t.title)
    const tl = title.toLowerCase()
    let minutes = DEFAULT_PREDICTED
    let source = "predicted_default"

    for (const h of hints) {
      if (h.pattern && tl.includes(h.pattern)) {
        minutes = h.minutes
        source = "predicted_learned_hint"
        break
      }
    }
    if (source === "predicted_default") {
      for (const rule of RULES) {
        if (rule.re.test(title)) {
          minutes = rule.minutes
          source = "predicted_keyword"
          break
        }
      }
    }

    byTask.push({
      id: t.id,
      title,
      minutes,
      source,
    })
    return { ...t, estimatedMinutes: minutes }
  })
  return { tasks: out, byTask }
}
