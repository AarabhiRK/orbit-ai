/** Browser-local ORBIT profile, streak, structured long-term goals, and calendar tasks. */

const K_PROFILE = "orbit_v2_profile"
const K_LT_GOALS = "orbit_v2_long_term_goals"
const K_CALENDAR = "orbit_v2_calendar"
const K_LAST_AUTH_EMAIL = "orbit_v1_last_auth_email"

export function ymdFromDate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function addDaysToYmd(ymd, deltaDays) {
  const [y, mo, da] = ymd.split("-").map(Number)
  const d = new Date(y, mo - 1, da)
  d.setDate(d.getDate() + deltaDays)
  return ymdFromDate(d)
}

function daysBetweenYmd(a, b) {
  const [ya, ma, da] = a.split("-").map(Number)
  const [yb, mb, db] = b.split("-").map(Number)
  const ua = Date.UTC(ya, ma - 1, da)
  const ub = Date.UTC(yb, mb - 1, db)
  return Math.round((ub - ua) / (86400000))
}

function defaultProfile() {
  return {
    displayName: "",
    /** Account email from GET /me/state (Supabase auth); not used for authentication. */
    email: "",
    lastVisitYmd: null,
    currentStreak: 0,
    longestStreak: 0,
    joinedAt: null,
    schemaVersion: 2,
  }
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(K_PROFILE)
    if (!raw) return defaultProfile()
    const j = JSON.parse(raw)
    return { ...defaultProfile(), ...j }
  } catch {
    return defaultProfile()
  }
}

export function saveProfile(p) {
  try {
    localStorage.setItem(K_PROFILE, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

/** Prefill the sign-in email field after refresh (local only). */
export function loadLastAuthEmail() {
  try {
    const e = localStorage.getItem(K_LAST_AUTH_EMAIL)
    return typeof e === "string" ? e : ""
  } catch {
    return ""
  }
}

export function saveLastAuthEmail(email) {
  try {
    const t = String(email || "").trim()
    if (t) localStorage.setItem(K_LAST_AUTH_EMAIL, t)
  } catch {
    /* ignore */
  }
}

/**
 * Call when the app opens with a known user — increments streak across calendar days.
 * @param {ReturnType<typeof loadProfile>} profile
 */
export function touchVisitStreak(profile) {
  const today = ymdFromDate()
  let { lastVisitYmd, currentStreak = 0, longestStreak = 0 } = profile
  if (lastVisitYmd === today) {
    return { ...profile }
  }
  if (!lastVisitYmd) {
    currentStreak = 1
  } else {
    const gap = daysBetweenYmd(lastVisitYmd, today)
    if (gap === 1) {
      currentStreak += 1
    } else {
      currentStreak = 1
    }
  }
  longestStreak = Math.max(longestStreak, currentStreak)
  return { ...profile, lastVisitYmd: today, currentStreak, longestStreak }
}

export function newId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
  }
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

export function loadLongTermGoals() {
  try {
    const raw = localStorage.getItem(K_LT_GOALS)
    if (!raw) return []
    const j = JSON.parse(raw)
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

export function saveLongTermGoals(rows) {
  try {
    localStorage.setItem(K_LT_GOALS, JSON.stringify(rows.slice(0, 24)))
  } catch {
    /* ignore */
  }
}

export function longTermGoalsToApiLine(goals) {
  const active = goals.filter((g) => g && !g.archived && String(g.text || "").trim())
  return active
    .map((g) => String(g.text).trim())
    .join(" · ")
    .slice(0, 560)
}

export function loadCalendar() {
  try {
    const raw = localStorage.getItem(K_CALENDAR)
    if (!raw) return {}
    const j = JSON.parse(raw)
    return j && typeof j === "object" ? j : {}
  } catch {
    return {}
  }
}

export function saveCalendar(map) {
  try {
    localStorage.setItem(K_CALENDAR, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/**
 * @param {Record<string, unknown[]>} calendar
 * @param {{ ymd: string, title: string, source?: string }[]} entries
 */
export function appendCalendarTasks(calendar, entries) {
  const next = { ...calendar }
  for (const { ymd, title, source } of entries) {
    if (!ymd || !String(title || "").trim()) continue
    const row = {
      id: newId("cal"),
      title: String(title).trim(),
      done: false,
      source: source || "manual",
    }
    next[ymd] = [...(next[ymd] || []), row]
  }
  return next
}

/** @param {Record<string, { title?: string, done?: boolean }[]>} cal */
export function collectUncheckedCalendarTaskLines(cal) {
  const lines = []
  for (const ymd of Object.keys(cal)) {
    for (const t of cal[ymd] || []) {
      if (!t?.done && String(t?.title || "").trim()) {
        lines.push(`${String(t.title).trim()} est:45`)
      }
    }
  }
  return lines
}

