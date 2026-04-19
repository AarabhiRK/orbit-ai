import { sanitizeBehaviorOutcomes } from "./behaviorMemory.js"
import {
  mergeOrbitWeightDeltas,
  sanitizeOrbitWeightDeltas,
  weightDeltasFromBehaviorOutcomes,
} from "./policyWeights.js"
import { taskStringsFromRaw } from "./normalizeTasks.js"
import { sanitizeMemoryRecent } from "./parseMemory.js"

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

function readPositiveFloatHours(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return NaN
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw))
  if (!Number.isFinite(n) || n <= 0) return NaN
  return n
}

/**
 * Minutes from `time` (minutes or phrases like `2 hours`) or `hours` / `hoursAvailable` (decimal hours).
 */
function resolveTimeAvailableMinutes(body) {
  const tRaw = body.time
  const hasT = tRaw !== undefined && tRaw !== null && String(tRaw).trim() !== ""
  if (hasT) {
    const n = parseTimeMinutes(tRaw)
    if (Number.isFinite(n) && n > 0) return n
    throw new ValidationError(
      "Time available must be a positive duration (e.g. 90, 2 hours, 1h 30m), or use hours instead.",
    )
  }
  const h = body.hours ?? body.hoursAvailable
  const hn = readPositiveFloatHours(h)
  if (!Number.isNaN(hn)) {
    return Math.max(1, Math.round(hn * 60))
  }
  throw new ValidationError(
    "Provide time as minutes in `time`, or decimal hours in `hours` (or `hoursAvailable`).",
  )
}

function assertSingleLineGoal(label, raw, maxLen = 220) {
  if (!raw) return
  if (raw.includes("\n") || raw.includes("\r")) {
    throw new ValidationError(
      `${label}: use one line only (one short statement; no line breaks).`,
    )
  }
  if (raw.length > maxLen) {
    throw new ValidationError(`${label}: keep to ${maxLen} characters or fewer.`)
  }
}

function computeOrbitWeights(body, behaviorOutcomes) {
  const client = sanitizeOrbitWeightDeltas(body.policy?.orbitWeightDeltas)
  const auto = weightDeltasFromBehaviorOutcomes(behaviorOutcomes)
  const combined = {
    urgency: (client.urgency ?? 0) + (auto.urgency ?? 0),
    goalAlignment: (client.goalAlignment ?? 0) + (auto.goalAlignment ?? 0),
    feasibility: (client.feasibility ?? 0) + (auto.feasibility ?? 0),
    riskReduction: (client.riskReduction ?? 0) + (auto.riskReduction ?? 0),
  }
  return mergeOrbitWeightDeltas(combined)
}

/**
 * @param {Record<string, unknown>} body
 */
function parseOrbitCommon(body) {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body must be a JSON object")
  }

  const tasksRaw = typeof body.tasks === "string" ? body.tasks : ""
  const shortRaw =
    typeof body.shortTermGoals === "string" ? body.shortTermGoals.trim() : ""
  const longRaw =
    typeof body.longTermGoals === "string" ? body.longTermGoals.trim() : ""
  assertSingleLineGoal("Short-term goals", shortRaw, 220)
  assertSingleLineGoal("Long-term goals", longRaw, 560)
  const short = shortRaw.slice(0, 220)
  const long = longRaw.slice(0, 560)
  let legacy = typeof body.goals === "string" ? body.goals.trim() : ""
  if (legacy) {
    legacy = legacy.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim().slice(0, 400)
  }

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

  const memoryRecent = sanitizeMemoryRecent(body.memory)
  const behaviorOutcomes = sanitizeBehaviorOutcomes(body.behavior)

  const lines = taskStringsFromRaw(tasksRaw)

  if (lines.length === 0) {
    throw new ValidationError("Enter at least one task (one per line)")
  }

  let asOfIso = null
  if (typeof body.asOf === "string" && body.asOf.trim()) {
    const ms = Date.parse(body.asOf.trim())
    if (!Number.isNaN(ms)) asOfIso = new Date(ms).toISOString()
  }

  const orbitWeights = computeOrbitWeights(body, behaviorOutcomes)

  return {
    tasksRaw,
    goalsRaw,
    goalsShort: short,
    goalsLong: long,
    memoryRecent,
    behaviorOutcomes,
    orbitWeights,
    energy: moodToEnergy(body.mood),
    asOfIso,
  }
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
  const c = parseOrbitCommon(body)
  const timeNum = resolveTimeAvailableMinutes(body)
  return {
    ...c,
    timeAvailableMinutes: timeNum,
  }
}

/**
 * Schedule mode: same task/goals/memory parsing plus horizon and per-day budget.
 * ORBIT scoring uses `minutesPerDay` as the feasibility window (same as planner capacity base).
 *
 * @param {Record<string, unknown>} body
 */
export function parseScheduleBody(body) {
  const c = parseOrbitCommon(body)
  const timeNum = resolveTimeAvailableMinutes(body)

  let minutesPerDay = timeNum
  const mpdRaw = body.minutesPerDay
  const mpdH = body.hoursPerDay ?? body.minutesPerDayHours
  if (mpdRaw !== undefined && mpdRaw !== null && String(mpdRaw).trim() !== "") {
    const n =
      typeof mpdRaw === "number"
        ? mpdRaw
        : Number.parseInt(String(mpdRaw), 10)
    if (Number.isFinite(n) && n > 0) minutesPerDay = Math.min(24 * 60, n)
  } else if (mpdH !== undefined && mpdH !== null && String(mpdH).trim() !== "") {
    const hn = readPositiveFloatHours(mpdH)
    if (!Number.isNaN(hn)) minutesPerDay = Math.min(24 * 60, Math.round(hn * 60))
  }

  const sdRaw = body.scheduleDays
  const sdParsed =
    typeof sdRaw === "number"
      ? sdRaw
      : typeof sdRaw === "string"
        ? Number.parseInt(sdRaw, 10)
        : NaN
  const scheduleDays = Number.isFinite(sdParsed)
    ? Math.min(14, Math.max(1, Math.floor(sdParsed)))
    : 7

  return {
    ...c,
    timeAvailableMinutes: minutesPerDay,
    scheduleDays,
    minutesPerDay,
  }
}
