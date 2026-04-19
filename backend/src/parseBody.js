export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.code = "VALIDATION"
  }
}

/**
 * @param {unknown} mood
 * @returns {"low"|"medium"|"high"}
 */
export function moodToEnergy(mood) {
  if (mood == null || String(mood).trim() === "") return "medium"
  const s = String(mood).toLowerCase().trim()
  if (/\b(low|tired|bad|rough|exhausted|drained)\b/.test(s)) return "low"
  if (/\b(high|great|energized|focused|wired)\b/.test(s)) return "high"
  const n = Number.parseInt(s, 10)
  if (n === 1 || n === 2) return "low"
  if (n === 5) return "high"
  if (n === 3 || n === 4) return "medium"
  return "medium"
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ tasksRaw: string, goalsRaw: string, timeAvailableMinutes: number, energy: ReturnType<moodToEnergy> }}
 */
export function parseGenerateBody(body) {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body must be a JSON object")
  }

  const tasksRaw = typeof body.tasks === "string" ? body.tasks : ""
  const goalsRaw = typeof body.goals === "string" ? body.goals : ""
  const mood = body.mood

  const lines = tasksRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    throw new ValidationError("Enter at least one task (one per line)")
  }

  const timeRaw = body.time
  const timeNum =
    typeof timeRaw === "number"
      ? timeRaw
      : typeof timeRaw === "string"
        ? Number.parseInt(timeRaw, 10)
        : NaN

  if (!Number.isFinite(timeNum) || timeNum <= 0) {
    throw new ValidationError("Time available must be a positive number (minutes)")
  }

  let asOfIso = null
  if (typeof body.asOf === "string" && body.asOf.trim()) {
    const ms = Date.parse(body.asOf.trim())
    if (!Number.isNaN(ms)) asOfIso = new Date(ms).toISOString()
  }

  return {
    tasksRaw,
    goalsRaw,
    timeAvailableMinutes: timeNum,
    energy: moodToEnergy(mood),
    asOfIso,
  }
}
