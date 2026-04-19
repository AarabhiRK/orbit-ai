import { sanitizeMemoryRecent } from "./parseMemory.js"
import { taskStringsFromRaw } from "./normalizeTasks.js"

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
 * Minutes from UI: plain number, "120", "2 hours", "90 min", "1h 30m".
 * @param {unknown} timeRaw
 * @returns {number}
 */
export function parseTimeMinutes(timeRaw) {
  if (typeof timeRaw === "number" && Number.isFinite(timeRaw) && timeRaw > 0) {
    return Math.round(timeRaw)
  }
  if (typeof timeRaw !== "string") return NaN
  const s = timeRaw.trim().toLowerCase()
  if (!s) return NaN

  if (/^\d+$/.test(s)) {
    return Number.parseInt(s, 10)
  }

  const hoursOnly = /^\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*$/i.exec(s)
  if (hoursOnly) {
    return Math.max(1, Math.round(Number(hoursOnly[1]) * 60))
  }

  const minsOnly = /^\s*(\d+)\s*(?:minutes?|mins?|m)\s*$/i.exec(s)
  if (minsOnly) {
    return Number.parseInt(minsOnly[1], 10)
  }

  const hm =
    /^\s*(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes)?)?\s*$/i.exec(s)
  if (hm) {
    return Number.parseInt(hm[1], 10) * 60 + Number.parseInt(hm[2], 10)
  }

  const leading = Number.parseInt(s, 10)
  if (Number.isFinite(leading) && leading > 0) return leading

  return NaN
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{
 *   tasksRaw: string,
 *   goalsRaw: string,
 *   goalsShort: string,
 *   goalsLong: string,
 *   memoryRecent: object[],
 *   timeAvailableMinutes: number,
 *   energy: ReturnType<moodToEnergy>,
 *   asOfIso: string | null,
 * }}
 */
export function parseGenerateBody(body) {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body must be a JSON object")
  }

  const tasksRaw = typeof body.tasks === "string" ? body.tasks : ""
  const short =
    typeof body.shortTermGoals === "string" ? body.shortTermGoals.trim() : ""
  const long =
    typeof body.longTermGoals === "string" ? body.longTermGoals.trim() : ""
  const legacy = typeof body.goals === "string" ? body.goals.trim() : ""

  let goalsRaw = ""
  if (short || long) {
    const parts = []
    if (short) parts.push(`Short-term: ${short}`)
    if (long) parts.push(`Long-term: ${long}`)
    goalsRaw = parts.join("\n")
    if (legacy) goalsRaw += `\nContext: ${legacy}`
  } else {
    goalsRaw = legacy
  }

  const mood = body.mood
  const memoryRecent = sanitizeMemoryRecent(body.memory)

  const lines = taskStringsFromRaw(tasksRaw)

  if (lines.length === 0) {
    throw new ValidationError("Enter at least one task (one per line)")
  }

  const timeNum = parseTimeMinutes(body.time)

  if (!Number.isFinite(timeNum) || timeNum <= 0) {
    throw new ValidationError(
      "Time available must be a positive duration (e.g. 90, 2 hours, 1h 30m)",
    )
  }

  let asOfIso = null
  if (typeof body.asOf === "string" && body.asOf.trim()) {
    const ms = Date.parse(body.asOf.trim())
    if (!Number.isNaN(ms)) asOfIso = new Date(ms).toISOString()
  }

  return {
    tasksRaw,
    goalsRaw,
    goalsShort: short,
    goalsLong: long,
    memoryRecent,
    timeAvailableMinutes: timeNum,
    energy: moodToEnergy(mood),
    asOfIso,
  }
}
