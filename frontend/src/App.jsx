import { useEffect, useMemo, useRef, useState } from "react"
import LoginOverlay from "./components/LoginOverlay.jsx"
import LongTermGoalsPanel from "./components/LongTermGoalsPanel.jsx"
import CalendarMonth from "./components/CalendarMonth.jsx"
import {
  appendCalendarTasks,
  collectUncheckedCalendarTaskLines,
  loadCalendar,
  loadLongTermGoals,
  loadProfile,
  longTermGoalsToApiLine,
  saveCalendar,
  saveLastAuthEmail,
  saveLongTermGoals,
  saveProfile,
  ymdFromDate,
} from "./lib/orbitLocalStore.js"
import { getSupabase, isSupabaseClientConfigured } from "./lib/supabaseClient.js"

const apiBase = (import.meta.env.VITE_API_URL ?? "http://localhost:5050").replace(
  /\/$/,
  "",
)

function isBrowserNetworkError(err) {
  const msg = String(err?.message ?? err)
  return (
    msg === "Failed to fetch" ||
    msg === "Load failed" ||
    (err?.name === "TypeError" && /fetch|network/i.test(msg))
  )
}

/** ORBIT API on `apiBase` — turns the browser's vague "Failed to fetch" into an actionable message. */
async function backendFetch(path, init) {
  const p = path.startsWith("/") ? path : `/${path}`
  const url = `${apiBase}${p}`
  try {
    return await fetch(url, init)
  } catch (err) {
    if (isBrowserNetworkError(err)) {
      throw new Error(
        `Cannot reach ORBIT backend at ${apiBase} (browser: "Failed to fetch"). ` +
          `Start the API: cd backend && npm start (default port 5050). ` +
          `If you use another port, set VITE_API_URL in frontend/.env.development.local to match, then restart the Vite dev server.`,
      )
    }
    throw err instanceof Error ? err : new Error(String(err))
  }
}

const ORBIT_MEMORY_KEY = "orbit_v1_session_memory"
const ORBIT_BEHAVIOR_KEY = "orbit_v1_behavior_outcomes"
const ORBIT_POLICY_KEY = "orbit_v1_policy_deltas"
const ORBIT_DURATION_HINTS_KEY = "orbit_v1_duration_hint_overrides"

function loadPolicyDeltas() {
  try {
    const raw = localStorage.getItem(ORBIT_POLICY_KEY)
    if (!raw) return {}
    const j = JSON.parse(raw)
    return j && typeof j === "object" ? j : {}
  } catch {
    return {}
  }
}

function savePolicyDeltas(d) {
  try {
    localStorage.setItem(ORBIT_POLICY_KEY, JSON.stringify(d))
  } catch {
    /* ignore */
  }
}

function nudgePolicyAfterIgnored() {
  const d = loadPolicyDeltas()
  d.urgency = (Number(d.urgency) || 0) + 0.012
  d.goalAlignment = (Number(d.goalAlignment) || 0) + 0.01
  d.feasibility = (Number(d.feasibility) || 0) - 0.008
  d.riskReduction = (Number(d.riskReduction) || 0) + 0.006
  savePolicyDeltas(d)
}

function loadDurationHintOverrides() {
  try {
    const raw = localStorage.getItem(ORBIT_DURATION_HINTS_KEY)
    if (!raw) return { overrides: [] }
    const j = JSON.parse(raw)
    return j && Array.isArray(j.overrides) ? j : { overrides: [] }
  } catch {
    return { overrides: [] }
  }
}

function pushDurationHintFromTitle(title) {
  const w = String(title || "")
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z0-9]/g, "")
  if (!w || w.length < 3) return
  const prev = loadDurationHintOverrides()
  const overrides = [...(prev.overrides || [])]
  const idx = overrides.findIndex((o) => o.pattern === w)
  const cur = idx >= 0 ? overrides[idx].minutes : 50
  const next = Math.max(10, Math.round(cur * 0.92))
  if (idx >= 0) overrides[idx] = { pattern: w, minutes: next }
  else overrides.unshift({ pattern: w, minutes: next })
  try {
    localStorage.setItem(
      ORBIT_DURATION_HINTS_KEY,
      JSON.stringify({ overrides: overrides.slice(0, 16) }),
    )
  } catch {
    /* ignore */
  }
}

function loadSessionMemory() {
  try {
    const raw = localStorage.getItem(ORBIT_MEMORY_KEY)
    if (!raw) return { recentRuns: [] }
    const j = JSON.parse(raw)
    return j && Array.isArray(j.recentRuns) ? j : { recentRuns: [] }
  } catch {
    return { recentRuns: [] }
  }
}

function loadBehaviorOutcomes() {
  try {
    const raw = localStorage.getItem(ORBIT_BEHAVIOR_KEY)
    if (!raw) return []
    const j = JSON.parse(raw)
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

function persistBehaviorOutcomes(rows) {
  try {
    localStorage.setItem(ORBIT_BEHAVIOR_KEY, JSON.stringify(rows.slice(0, 30)))
  } catch {
    /* ignore */
  }
}

function pushBehaviorOutcome({ outcome, topTitle }) {
  if (!topTitle?.trim()) return
  const rows = loadBehaviorOutcomes()
  rows.unshift({
    at: new Date().toISOString(),
    topTitle: topTitle.trim(),
    outcome,
  })
  persistBehaviorOutcomes(rows)
}

function rememberNextActionRun(data) {
  try {
    const prev = loadSessionMemory()
    const runs = Array.isArray(prev.recentRuns) ? [...prev.recentRuns] : []
    const topTitle =
      data.candidates_top_3?.[0]?.title ??
      data.orbit?.ranked?.[0]?.title ??
      ""
    runs.unshift({
      at: new Date().toISOString(),
      action: data.action ?? "",
      topTitle,
      orbitScoreTop: data.orbit?.ranked?.[0]?.orbitScore ?? null,
    })
    localStorage.setItem(
      ORBIT_MEMORY_KEY,
      JSON.stringify({ recentRuns: runs.slice(0, 8) }),
    )
  } catch {
    /* ignore */
  }
}

function rememberScheduleRun(data) {
  try {
    const prev = loadSessionMemory()
    const runs = Array.isArray(prev.recentRuns) ? [...prev.recentRuns] : []
    const firstTitle =
      data.schedule?.days?.[0]?.blocks?.[0]?.title ??
      data.orbit?.ranked?.[0]?.title ??
      ""
    runs.unshift({
      at: new Date().toISOString(),
      action: data.action ?? "",
      topTitle: firstTitle,
      orbitScoreTop: data.orbit?.ranked?.[0]?.orbitScore ?? null,
    })
    localStorage.setItem(
      ORBIT_MEMORY_KEY,
      JSON.stringify({ recentRuns: runs.slice(0, 8) }),
    )
  } catch {
    /* ignore */
  }
}

const ORBIT_OTHER_CANDIDATES_RISK_MARKER =
  "\n\n--- Other top candidates (if not done) ---\n"

/** @param {string | undefined} risk */
function splitRiskForDisplay(risk) {
  if (!risk || risk === "—") {
    return { coreLines: [], tipLines: [], memoryLines: [], otherLines: [] }
  }
  const idx = risk.indexOf(ORBIT_OTHER_CANDIDATES_RISK_MARKER)
  const main =
    idx === -1 ? risk : risk.slice(0, idx)
  const tail =
    idx === -1 ? "" : risk.slice(idx + ORBIT_OTHER_CANDIDATES_RISK_MARKER.length)
  const mainLines = main.split("\n").map((l) => l.trim()).filter(Boolean)
  const coreLines = []
  const tipLines = []
  const memoryLines = []
  for (const line of mainLines) {
    if (line.startsWith("Tip:")) tipLines.push(line)
    else if (line.startsWith("Session memory")) memoryLines.push(line)
    else coreLines.push(line)
  }
  const otherLines = tail
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  return { coreLines, tipLines, memoryLines, otherLines }
}

/** @param {Record<string, unknown> | null} result @param {string | null | undefined} taskId */
function taskTitleForId(result, taskId) {
  if (!taskId || !result?.orbit?.ranked) return null
  const row = result.orbit.ranked.find((r) => r.id === taskId)
  return row?.title ?? null
}

/** @param {unknown} n */
function formatOrbitScoreShort(n) {
  if (n == null || Number.isNaN(Number(n))) return "—"
  return Number(n).toFixed(2)
}

/** @param {string | undefined} level */
function orbitRiskCardClass(level) {
  const u = String(level || "").toUpperCase()
  if (u === "LOW") return "orbit-risk-card orbit-risk-card--low"
  if (u === "HIGH" || u === "CRITICAL") return "orbit-risk-card"
  return "orbit-risk-card orbit-risk-card--mid"
}

function formatClock(m) {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

export default function App() {
  const [tasks, setTasks] = useState("")
  const [mood, setMood] = useState("")
  const [time, setTime] = useState("")
  const [minutesPerDay, setMinutesPerDay] = useState("")
  const [scheduleDays, setScheduleDays] = useState("7")
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [shortTermGoals, setShortTermGoals] = useState("")
  const [feedbackNote, setFeedbackNote] = useState("")
  const [mode, setMode] = useState("next_action")
  const [hours, setHours] = useState("")
  const [profile, setProfile] = useState(loadProfile)
  const [goalRows, setGoalRows] = useState(loadLongTermGoals)
  const [calendar, setCalendar] = useState(loadCalendar)
  const [lifeTab, setLifeTab] = useState("run")
  const [accessToken, setAccessToken] = useState(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState("")
  const [authReady, setAuthReady] = useState(() => !isSupabaseClientConfigured())

  const longTermGoalsForApi = useMemo(() => longTermGoalsToApiLine(goalRows), [goalRows])

  /** One in-flight hydrate per access token — avoids sign-in racing `handleSignIn` vs `onAuthStateChange`. */
  const hydrateInFlightRef = useRef(new Map())
  /** After hydrate succeeds for this Supabase user, ignore duplicate `SIGNED_IN` (user id is stable; JWT strings can differ). */
  const signedInHydratedUserIdRef = useRef(null)

  const readJsonOrText = async (res) => {
    const ct = res.headers.get("content-type") || ""
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => ({}))
      return { json: j, text: null }
    }
    const text = await res.text().catch(() => "")
    return { json: {}, text: text?.slice(0, 400) || null }
  }

  const hydrateFromServer = async (token) => {
    const h = await backendFetch("/health")
    if (!h.ok) {
      throw new Error(
        `Cannot reach ORBIT backend at ${apiBase} (GET /health returned ${h.status}). Start the API (cd backend && npm start) and set VITE_API_URL in frontend/.env.development.local if you use a port other than 5050.`,
      )
    }
    const hj = await h.json().catch(() => ({}))
    if (hj.supabase_configured !== true) {
      const env = hj.supabase_env || {}
      const missing = []
      if (!env.url_set) missing.push("SUPABASE_URL")
      if (!env.anon_key_set) missing.push("SUPABASE_ANON_KEY")
      if (!env.service_role_set) missing.push("SUPABASE_SERVICE_ROLE_KEY")
      const hint =
        missing.length > 0
          ? ` Missing in backend/.env: ${missing.join(", ")}. Restart the API after saving.`
          : " Restart the API after changing backend/.env."
      throw new Error(
        `Backend is not ready for account sync (supabase_configured is false).${hint} Same Supabase project must be used in frontend (VITE_SUPABASE_*) and backend (SUPABASE_*).`,
      )
    }
    const visit = await backendFetch("/me/visit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!visit.ok) {
      const { json: err, text } = await readJsonOrText(visit)
      if (visit.status === 404) {
        throw new Error(
          "POST /me/visit returned 404 — the API did not register account routes. Usually SUPABASE_ANON_KEY is missing in backend/.env (all three Supabase vars are required). Restart backend and confirm GET /health shows supabase_configured: true.",
        )
      }
      if (visit.status === 401) {
        throw new Error(
          err.error ??
            "Invalid or expired session on the server. Use the same Supabase project in frontend/.env.development.local (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY) and backend/.env (SUPABASE_URL + SUPABASE_ANON_KEY).",
        )
      }
      throw new Error(err.error ?? text ?? `Visit failed (${visit.status})`)
    }
    const r = await backendFetch("/me/state", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { json: j, text: stateText } = await readJsonOrText(r)
    if (!r.ok) {
      if (r.status === 401) {
        throw new Error(
          j.error ??
            "Invalid or expired session on /me/state. Backend anon key must match the project that issued your login (same keys as in the Supabase dashboard → Settings → API).",
        )
      }
      throw new Error(j.error ?? stateText ?? `State failed (${r.status})`)
    }
    const p = {
      displayName: j.displayName || "",
      email: typeof j.email === "string" ? j.email : "",
      lastVisitYmd: j.lastVisitYmd,
      currentStreak: j.currentStreak ?? 0,
      longestStreak: j.longestStreak ?? 0,
      joinedAt: loadProfile().joinedAt || new Date().toISOString(),
      schemaVersion: 2,
    }
    setProfile(p)
    saveProfile(p)
    const goals = Array.isArray(j.goals) ? j.goals : []
    const cal = j.calendar && typeof j.calendar === "object" ? j.calendar : {}
    setGoalRows(goals)
    setCalendar(cal)
    saveLongTermGoals(goals)
    saveCalendar(cal)
    if (p.email) saveLastAuthEmail(p.email)
  }

  const hydrateWithDedupe = async (token) => {
    if (!token) return
    const map = hydrateInFlightRef.current
    let p = map.get(token)
    if (!p) {
      p = hydrateFromServer(token).finally(() => {
        if (map.get(token) === p) map.delete(token)
      })
      map.set(token, p)
    }
    await p
  }

  useEffect(() => {
    if (!isSupabaseClientConfigured()) return undefined
    const sb = getSupabase()
    if (!sb) {
      setAuthReady(true)
      return undefined
    }

    const init = async () => {
      try {
        const {
          data: { session },
        } = await sb.auth.getSession()
        const t = session?.access_token ?? null
        if (t) {
          try {
            await hydrateWithDedupe(t)
            signedInHydratedUserIdRef.current = session?.user?.id ?? null
            setAccessToken(t)
            setAuthError("")
          } catch (e) {
            setAuthError(e?.message ?? String(e))
            signedInHydratedUserIdRef.current = null
            await sb.auth.signOut()
            setAccessToken(null)
          }
        } else {
          setAccessToken(null)
        }
      } finally {
        setAuthReady(true)
      }
    }
    void init()

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      const tok = session?.access_token ?? null
      if (tok) {
        if (event === "TOKEN_REFRESHED") {
          setAccessToken(tok)
          return
        }
        if (
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          session?.user?.id &&
          signedInHydratedUserIdRef.current === session.user.id
        ) {
          setAccessToken(tok)
          return
        }
        void hydrateWithDedupe(tok)
          .then(() => {
            signedInHydratedUserIdRef.current = session?.user?.id ?? null
            setAccessToken(tok)
            setAuthError("")
          })
          .catch(async (e) => {
            setAuthError(e?.message ?? String(e))
            signedInHydratedUserIdRef.current = null
            await sb.auth.signOut()
            setAccessToken(null)
          })
      } else {
        // Do not clear authError here — signOut after a failed hydrate also hits this branch,
        // and clearing would hide the message before the user can read it.
        signedInHydratedUserIdRef.current = null
        setAccessToken(null)
        setProfile(loadProfile())
        setGoalRows([])
        setCalendar({})
      }
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate uses stable apiBase from module scope
  }, [])

  useEffect(() => {
    if (!accessToken) return undefined
    const t = setTimeout(() => {
      backendFetch("/me/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ goals: goalRows, calendar }),
      }).catch(() => {})
    }, 900)
    return () => clearTimeout(t)
  }, [goalRows, calendar, accessToken, apiBase])

  const handleSignIn = async ({ email, password }) => {
    const sb = getSupabase()
    if (!sb) return
    setAuthBusy(true)
    setAuthError("")
    let token = null
    let userId = null
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw error
      token = data.session?.access_token
      userId = data.session?.user?.id ?? null
      if (!token) throw new Error("No session — confirm your email in Supabase if confirmations are enabled.")
    } catch (e) {
      signedInHydratedUserIdRef.current = null
      await sb.auth.signOut()
      setAccessToken(null)
      const m = e?.message ?? String(e)
      setAuthError(
        isBrowserNetworkError(e)
          ? `Cannot reach Supabase for sign-in. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in frontend/.env.development.local and your network. (${m})`
          : m,
      )
      setAuthBusy(false)
      return
    }
    try {
      await hydrateWithDedupe(token)
      signedInHydratedUserIdRef.current = userId
      setAccessToken(token)
      setAuthError("")
    } catch (e) {
      signedInHydratedUserIdRef.current = null
      await sb.auth.signOut()
      setAccessToken(null)
      setAuthError(e?.message ?? String(e))
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignUp = async ({ email, password, displayName }) => {
    const sb = getSupabase()
    if (!sb) return
    setAuthBusy(true)
    setAuthError("")
    let token = null
    let userId = null
    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      })
      if (error) throw error
      token = data.session?.access_token
      userId = data.session?.user?.id ?? null
      if (!token) {
        saveLastAuthEmail(email)
        setAuthError(
          "Account created. If email confirmation is on in Supabase, check your inbox then sign in.",
        )
        setAuthBusy(false)
        return
      }
    } catch (e) {
      signedInHydratedUserIdRef.current = null
      await sb.auth.signOut()
      setAccessToken(null)
      const m = e?.message ?? String(e)
      setAuthError(
        isBrowserNetworkError(e)
          ? `Cannot reach Supabase for sign-up. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY and your network. (${m})`
          : m,
      )
      setAuthBusy(false)
      return
    }
    try {
      await hydrateWithDedupe(token)
      signedInHydratedUserIdRef.current = userId
      setAccessToken(token)
      setAuthError("")
    } catch (e) {
      signedInHydratedUserIdRef.current = null
      await sb.auth.signOut()
      setAccessToken(null)
      setAuthError(e?.message ?? String(e))
    } finally {
      setAuthBusy(false)
    }
  }

  const appendCalendarLinesToTasks = () => {
    const lines = collectUncheckedCalendarTaskLines(calendar)
    if (lines.length === 0) return
    const existing = new Set(
      tasks
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    )
    const merged = [...tasks.split(/\r?\n/), ...lines.filter((l) => !existing.has(l.trim().toLowerCase()))]
      .join("\n")
      .replace(/^\n+/, "")
      .trim()
    setTasks(merged)
  }

  const pinHeadlineToCalendar = () => {
    const title =
      result?.schedule?.days?.[0]?.blocks?.[0]?.title ??
      result?.candidates_top_3?.[0]?.title ??
      ""
    if (!title) return
    const next = appendCalendarTasks(calendar, [{ ymd: ymdFromDate(), title, source: "orbit" }])
    setCalendar(next)
    saveCalendar(next)
    setFeedbackNote("Pinned headline to today on your calendar.")
  }

  const generate = async () => {
    setLoading(true)
    setResult(null)
    setFeedbackNote("")

    try {
      const body = {
        tasks,
        mood,
        shortTermGoals,
        longTermGoals: longTermGoalsForApi,
        memory: loadSessionMemory(),
        behavior: { outcomes: loadBehaviorOutcomes() },
        policy: { orbitWeightDeltas: loadPolicyDeltas() },
        durationHints: loadDurationHintOverrides(),
      }
      if (time.trim()) body.time = time.trim()
      else if (hours.trim()) body.hours = Number.parseFloat(hours)

      const endpoint =
        mode === "next_action" ? "/generate-next-action" : "/generate-schedule"

      if (mode === "schedule") {
        body.scheduleDays = Number.parseInt(scheduleDays, 10) || 7
        if (minutesPerDay.trim()) {
          body.minutesPerDay = Number.parseInt(minutesPerDay, 10)
        } else if (hours.trim() && !time.trim()) {
          body.hoursPerDay = Number.parseFloat(hours)
        }
      }

      const headers = { "Content-Type": "application/json" }
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`
      const res = await backendFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })

      let data = {}
      try {
        data = await res.json()
      } catch {
        data = { error: `Invalid response from server (${res.status})` }
      }
      if (!res.ok) {
        const base = data.error ?? `Server error (${res.status})`
        const gemini503 =
          res.status === 503 && data.system === "gemini_required"
            ? " Set GEMINI_API_KEY in backend/.env (Google AI Studio), restart the server, and retry."
            : ""
        const gemini502 =
          res.status === 502 && data.system === "gemini_narrative_failed"
            ? " Check API quota, model name, or network; then retry."
            : ""
        setResult({
          mode: "error",
          action:
            mode === "schedule" ? "Could not build schedule" : "Could not get next action",
          reason: `${base}${gemini503}${gemini502}`,
          steps: [
            "Enter tasks (one per line); optional est:90 due:2026-04-22",
            mode === "schedule"
              ? "Set time or hours per day; schedule days 1–14"
              : "Set time available (minutes or hours)",
            "Backend: cd backend && npm start (needs GEMINI_API_KEY in backend/.env)",
          ],
          risk: "—",
          future_impact: "—",
          confidence: 0,
          inputError: true,
        })
        return
      }
      setResult(data)
      if (mode === "schedule") rememberScheduleRun(data)
      else rememberNextActionRun(data)
    } catch (e) {
      const reason =
        e instanceof Error && e.message
          ? e.message
          : "Start the ORBIT API server and retry."
      setResult({
        mode: "error",
        action: "Backend not connected",
        reason,
        steps: ["cd backend && npm start", "Confirm VITE_API_URL if not using :5050"],
        risk: "—",
        future_impact: "—",
        confidence: 0,
      })
    } finally {
      setLoading(false)
    }
  }

  const durationPredictions =
    result?.agents?.find((a) => a.id === "duration")?.output?.predictions ?? []

  const primaryBlockTitle =
    result?.schedule?.days?.[0]?.blocks?.[0]?.title ??
    result?.candidates_top_3?.[0]?.title ??
    ""

  const rankedList = result?.orbit?.ranked ?? []
  const riskParts =
    result && !result.inputError ? splitRiskForDisplay(result.risk) : null
  const llmPickTitle =
    result && !result.inputError && result.llm_selected_task_id
      ? taskTitleForId(result, result.llm_selected_task_id)
      : null

  if (!isSupabaseClientConfigured()) {
    return <LoginOverlay supabaseMissing />
  }

  if (!authReady) {
    return <div className="orbit-auth-loading">Restoring session…</div>
  }

  if (!accessToken) {
    return (
      <LoginOverlay
        supabaseMissing={false}
        onSignIn={handleSignIn}
        onSignUp={handleSignUp}
        busy={authBusy}
        errorText={authError}
        onDismissError={() => setAuthError("")}
      />
    )
  }

  return (
    <div className="orbit-app">
      <div className="orbit-header-strip">
        <div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Signed in as</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{profile.displayName?.trim() || "ORBIT user"}</div>
          {profile.email ? (
            <div style={{ fontSize: 13, opacity: 0.88, marginTop: 4 }}>{profile.email}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div className="orbit-streak-pill">
            <div className="orbit-streak-pill__label">Streak</div>
            <div className="orbit-streak-pill__value">{profile.currentStreak ?? 0}🔥</div>
          </div>
          <div className="orbit-streak-pill orbit-streak-pill--compact orbit-streak-pill--muted">
            <div className="orbit-streak-pill__label">Best</div>
            <div className="orbit-streak-pill__value">{profile.longestStreak ?? 0}</div>
          </div>
          <button
            type="button"
            className="orbit-header-btn orbit-header-btn--ghost"
            onClick={async () => {
              setAuthError("")
              const sb = getSupabase()
              await sb?.auth.signOut()
            }}
          >
            Switch user
          </button>
        </div>
      </div>

      {authError ? <p className="orbit-alert">{authError}</p> : null}

      <h1 className="orbit-title">ORBIT</h1>
      <p className="orbit-lede">
        Your space to line up what matters—goals, mood, and tasks in one view. ORBIT suggests a focused next step
        or lays out a multi-day plan, with scoring you can follow so it never feels like a mystery why something
        landed at the top of your list.
      </p>
      {import.meta.env.DEV && (
        <p className="orbit-dev-hint">
          API: <code>{apiBase}</code>
        </p>
      )}

      <div className="orbit-tabs">
        <button
          type="button"
          className={`orbit-tab${lifeTab === "run" ? " orbit-tab--active" : ""}`}
          onClick={() => setLifeTab("run")}
        >
          Run ORBIT
        </button>
        <button
          type="button"
          className={`orbit-tab${lifeTab === "calendar" ? " orbit-tab--active" : ""}`}
          onClick={() => setLifeTab("calendar")}
        >
          Calendar
        </button>
        <button
          type="button"
          className={`orbit-tab${lifeTab === "goals" ? " orbit-tab--active" : ""}`}
          onClick={() => setLifeTab("goals")}
        >
          Long-term goals
        </button>
      </div>

      {lifeTab === "calendar" && (
        <div className="orbit-section-stack">
          <CalendarMonth
            calendar={calendar}
            setCalendar={setCalendar}
            onAppendTasksFromCalendar={appendCalendarLinesToTasks}
          />
        </div>
      )}

      {lifeTab === "goals" && (
        <div className="orbit-section-stack">
          <LongTermGoalsPanel
            goals={goalRows}
            setGoals={setGoalRows}
            calendar={calendar}
            setCalendar={setCalendar}
            shortTermGoals={shortTermGoals}
            apiBase={apiBase}
            accessToken={accessToken}
            tasks={tasks}
            setTasks={setTasks}
          />
        </div>
      )}

      {lifeTab === "run" && (
        <>
      <div className="orbit-tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`orbit-tab${mode === "next_action" ? " orbit-tab--active" : ""}`}
          onClick={() => setMode("next_action")}
        >
          Next action (primary)
        </button>
        <button
          type="button"
          className={`orbit-tab${mode === "schedule" ? " orbit-tab--active" : ""}`}
          onClick={() => setMode("schedule")}
        >
          Multi-day schedule
        </button>
      </div>

      <p className="orbit-system-line">
        System:{" "}
        {!result
          ? "Idle"
          : result.inputError
            ? "Validation"
            : result.confidence === 0 && result.mode === "error"
              ? "Offline"
              : result.mode === "single_next_action"
                ? "ORBIT next action"
                : "ORBIT schedule"}
      </p>

      <textarea
        className="orbit-textarea"
        placeholder="Tasks: one per line, or several on one line separated by commas (e.g. CS homework, dishes). Optional per line: est:45 due:2026-04-22 after:task_0. Time: minutes or phrases like 2 hours, 90 min."
        style={{ minHeight: 110, marginBottom: 10 }}
        onChange={(e) => setTasks(e.target.value)}
        value={tasks}
      />

      <textarea
        className="orbit-textarea"
        placeholder="Short-term goals — one line only, max 220 chars (1 short statement)"
        maxLength={220}
        style={{ minHeight: 56, marginBottom: 10 }}
        onChange={(e) => setShortTermGoals(e.target.value)}
        value={shortTermGoals}
      />

      {goalRows.length > 0 ? (
        <p className="orbit-muted-label" style={{ marginBottom: 10, lineHeight: 1.45 }}>
          <strong>Long-term</strong> (from Goals tab, sent to ORBIT):{" "}
          {longTermGoalsForApi || "—"}
        </p>
      ) : (
        <p className="orbit-muted-label" style={{ marginBottom: 10, opacity: 0.92 }}>
          Add long-term goals under the <strong>Long-term goals</strong> tab — they flow into scoring automatically.
        </p>
      )}

      <div className="orbit-grid-inputs">
        <input
          className="orbit-field"
          placeholder="Mood (1–5 or words)"
          onChange={(e) => setMood(e.target.value)}
          value={mood}
        />
        <input
          className="orbit-field"
          placeholder={mode === "schedule" ? "Minutes / day (or e.g. 2h)" : "Time budget (e.g. 90, 2 hours, 1h 30m)"}
          onChange={(e) => setTime(e.target.value)}
          value={time}
        />
        <input
          className="orbit-field"
          placeholder="Or hours (decimal)"
          onChange={(e) => setHours(e.target.value)}
          value={hours}
        />
        {mode === "schedule" && (
          <>
            <input
              className="orbit-field"
              placeholder="Override min/day (optional)"
              onChange={(e) => setMinutesPerDay(e.target.value)}
              value={minutesPerDay}
            />
            <input
              className="orbit-field"
              placeholder="Horizon days (1–14)"
              onChange={(e) => setScheduleDays(e.target.value)}
              value={scheduleDays}
            />
          </>
        )}
      </div>

      <button
        type="button"
        className="orbit-btn orbit-btn--primary"
        onClick={generate}
        disabled={loading}
      >
        {loading ? "Running agents…" : mode === "schedule" ? "Build schedule" : "Get next action"}
      </button>

      {loading && (
        <p className="orbit-run-hint">
          User profile → durations → ORBIT core →{" "}
          {mode === "schedule" ? "scheduler → Sentinel…" : "Sentinel (×3) → LLM pick among top 3…"}
        </p>
      )}
        </>
      )}

      {lifeTab !== "run" && result && !result.inputError && (
        <p className="orbit-muted-block">
          Last ORBIT result is below — switch to <strong>Run ORBIT</strong> to regenerate.
        </p>
      )}

      {result && !result.inputError && result.userModel && (
        <section className="orbit-run-profile-card">
          <div className="orbit-run-profile-card__top">
            <h2 className="orbit-run-profile-card__title">How ORBIT sees you</h2>
            {result.debug?.narrative_source === "deterministic_fallback" ? (
              <span className="orbit-run-pill orbit-run-pill--muted" title={result.debug?.llm?.error}>
                Standard coaching copy
              </span>
            ) : result.debug?.narrative_source === "gemini" ? (
              <span className="orbit-run-pill orbit-run-pill--accent">Personalized notes</span>
            ) : null}
          </div>
          <p className="orbit-run-profile-card__summary">{result.userModel.summary}</p>
          {(result.userModel.tags || []).length > 0 ? (
            <div className="orbit-run-tag-row" aria-label="Tags">
              {(result.userModel.tags || []).map((t) => (
                <span key={t} className="orbit-run-tag">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {result.userModel?.behavior_profile ? (
            <dl className="orbit-run-behavior-grid">
              <div className="orbit-run-behavior-cell">
                <dt>Completion</dt>
                <dd>{result.userModel.behavior_profile.completion_rate_0_100 ?? "—"}%</dd>
              </div>
              <div className="orbit-run-behavior-cell">
                <dt>Procrastination signal</dt>
                <dd>{result.userModel.behavior_profile.procrastination_tendency_0_100 ?? "—"}/100</dd>
              </div>
              <div className="orbit-run-behavior-cell">
                <dt>Focus stability</dt>
                <dd>{result.userModel.behavior_profile.focus_duration_pattern_score_0_100 ?? "—"}/100</dd>
              </div>
              <div className="orbit-run-behavior-cell">
                <dt>Ignored suggestions</dt>
                <dd>{result.userModel.behavior_profile.ignored_recommendations_count ?? 0}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      )}

      {result && !result.inputError && (
        <section className="orbit-run-plan">
          {rankedList.length > 0 && (
            <div className="orbit-run-rank-card">
              <div className="orbit-run-section-label">Task ranking</div>
              <p className="orbit-run-lead">
                {rankedList.length === 1
                  ? "One task on your list — this is your focus."
                  : `We compared ${rankedList.length} tasks using your goals, time, and risk signals. #1 is the best match right now.`}
              </p>
              {rankedList.length > 1 ? (
                <ol className="orbit-run-rank-list">
                  {rankedList.map((r, i) => (
                    <li
                      key={r.id ?? i}
                      className={i === 0 ? "orbit-run-rank-li orbit-run-rank-li--top" : "orbit-run-rank-li"}
                    >
                      <span className="orbit-run-rank-li__title">{r.title}</span>
                      <span className="orbit-run-rank-li__score" title="ORBIT composite score">
                        {formatOrbitScoreShort(r.orbitScore)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          )}

          <div className="orbit-run-hero">
            <div className="orbit-run-section-label">
              {result.mode === "single_next_action" ? "Your next step" : "Headline"}
            </div>
            <p className="orbit-run-hero__action">{result.action}</p>
            <button
              type="button"
              className="orbit-btn--outline orbit-btn--outline-indigo orbit-run-hero__btn"
              onClick={pinHeadlineToCalendar}
              disabled={!primaryBlockTitle}
            >
              {"Add to today's calendar"}
            </button>
          </div>

          {llmPickTitle ? (
            <div className="orbit-run-align">
              <span className="orbit-run-align__label">Assistant alignment</span>
              <p className="orbit-run-align__text">
                The narrative layer matched <strong>{llmPickTitle}</strong> as the task to emphasize among your top
                picks.
              </p>
            </div>
          ) : null}

          <div className="orbit-run-reason-card">
            <div className="orbit-run-section-label">Why this pick</div>
            <p className="orbit-run-prose">{result.reason}</p>
          </div>
        </section>
      )}

      {result && !result.inputError && result.schedule && (
        <section className="orbit-schedule-section">
          <h2>Schedule by day</h2>
          <p className="orbit-schedule-meta">
            Times are minute offsets in your work window (00:00 = start of the block you protect for deep work).
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {result.schedule.days.map((day) => (
              <div key={day.dayIndex} className="orbit-schedule-day">
                <div className="orbit-schedule-day__title">
                  Day {day.dayIndex + 1} · {day.date}{" "}
                  <span className="orbit-schedule-day__meta">
                    ({day.usedMinutes}/{day.capacityMinutes} min used)
                  </span>
                </div>
                {day.blocks.length === 0 ? (
                  <div className="orbit-muted-label" style={{ fontSize: 14 }}>
                    No blocks (overflow or empty).
                  </div>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                    {day.blocks.map((b, i) => (
                      <li key={`${day.dayIndex}-${i}-${b.taskId}`}>
                        <strong>{formatClock(b.startMinuteInDay)}–{formatClock(b.endMinuteInDay)}</strong> ·{" "}
                        {b.title}{" "}
                        <span className="orbit-muted-label" style={{ display: "inline" }}>
                          ({b.minutes} min)
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
          {result.schedule.overflow?.length > 0 && (
            <div className="orbit-banner-warn">
              <strong>Did not fit</strong>:{" "}
              {result.schedule.overflow.map((o) => `${o.title} (${o.unscheduledMinutes}m left)`).join("; ")}
            </div>
          )}
        </section>
      )}

      {result && !result.inputError && durationPredictions.length > 0 && (
        <section className="orbit-table-section">
          <h2>Duration agent</h2>
          <table className="orbit-data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Minutes</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {durationPredictions.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td>{p.minutes}</td>
                  <td className="orbit-td-muted">{p.source.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {result && !result.inputError && riskParts && (
        <div className="orbit-run-followup">
          <section className={orbitRiskCardClass(result.sentinel?.riskLevel)}>
            <div className="orbit-risk-card__header">
              <span className="orbit-risk-card__title">Schedule risk</span>
              <span className="orbit-risk-card__subtitle">Sentinel check on your top task</span>
            </div>
            {riskParts.coreLines.length > 0 ? (
              <ul className="orbit-risk-card__lines">
                {riskParts.coreLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="orbit-risk-card__empty">No risk summary.</p>
            )}
            {riskParts.tipLines.map((line) => (
              <p key={line} className="orbit-risk-card__tip">
                {line}
              </p>
            ))}
            {riskParts.memoryLines.map((line) => (
              <p key={line} className="orbit-risk-card__memory">
                {line}
              </p>
            ))}
            {riskParts.otherLines.length > 0 ? (
              <div className="orbit-risk-card__others">
                <div className="orbit-run-section-label">Other strong tasks</div>
                <ul className="orbit-risk-card__other-list">
                  {riskParts.otherLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <div className="orbit-run-prose-block">
            <div className="orbit-run-section-label">If you follow through</div>
            <p className="orbit-run-prose">{result.future_impact}</p>
          </div>

          <div className="orbit-run-confidence">
            <div className="orbit-run-section-label">Confidence in this suggestion</div>
            <div className="orbit-run-confidence__stats">
              <div className="orbit-run-stat-pill">
                <span className="orbit-run-stat-pill__value">{result.confidence}%</span>
                <span className="orbit-run-stat-pill__label">Overall</span>
              </div>
              {result.confidence_margin_percent != null ? (
                <div className="orbit-run-stat-pill orbit-run-stat-pill--secondary">
                  <span className="orbit-run-stat-pill__value">{result.confidence_margin_percent}%</span>
                  <span className="orbit-run-stat-pill__label">Lead vs runner-up</span>
                </div>
              ) : null}
            </div>
            {result.confidence_breakdown ? (
              <div className="orbit-breakdown-box orbit-run-breakdown">
                <div className="orbit-run-breakdown__grid">
                  <div>
                    <span className="orbit-run-breakdown__k">Data quality</span>
                    <span className="orbit-run-breakdown__v">{result.confidence_breakdown.data_confidence}</span>
                  </div>
                  <div>
                    <span className="orbit-run-breakdown__k">Decision stability</span>
                    <span className="orbit-run-breakdown__v">{result.confidence_breakdown.decision_stability}</span>
                  </div>
                  <div>
                    <span className="orbit-run-breakdown__k">Risk uncertainty</span>
                    <span className="orbit-run-breakdown__v">{result.confidence_breakdown.risk_uncertainty}</span>
                  </div>
                </div>
                <p className="orbit-run-breakdown__note">{result.confidence_breakdown.note}</p>
              </div>
            ) : null}
          </div>

          {result.alternatives && result.alternatives.length > 0 ? (
            <div className="orbit-run-alt-section">
              <div className="orbit-run-section-label">Solid runners-up</div>
              <ul className="orbit-run-alt-grid">
                {result.alternatives.map((a) => (
                  <li key={a.id} className="orbit-run-alt-card">
                    <div className="orbit-run-alt-card__head">
                      <span className="orbit-run-alt-card__title">{a.title}</span>
                      <span className="orbit-run-alt-card__badge">{formatOrbitScoreShort(a.orbitScore)}</span>
                    </div>
                    <p className="orbit-run-alt-card__meta">{a.one_line}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.tradeoffs ? (
            <div className="orbit-run-prose-block">
              <div className="orbit-run-section-label">Tradeoffs</div>
              <p className="orbit-run-prose">{result.tradeoffs}</p>
            </div>
          ) : null}

          {result.schedule?.discarded_from_packing?.length > 0 && (
            <div className="orbit-banner-yellow">
              <b>Auto-discarded from packing</b> (still in full rank list):{" "}
              {result.schedule.discarded_from_packing
                .map((d) => `${d.title} (${d.orbitScore?.toFixed?.(3) ?? d.orbitScore})`)
                .join("; ")}
            </div>
          )}

          <div className="orbit-feedback-card orbit-run-feedback">
            <div className="orbit-run-section-label">Quick feedback</div>
            <p className="orbit-run-feedback__hint">
              Log what you actually did so the next run can tune to you. Applies to:{" "}
              <strong>{primaryBlockTitle || "—"}</strong>
            </p>
            <div className="orbit-feedback-card__row">
              <button
                type="button"
                className="orbit-btn--sm orbit-btn--success"
                disabled={!primaryBlockTitle}
                onClick={() => {
                  pushBehaviorOutcome({ outcome: "done", topTitle: primaryBlockTitle })
                  setFeedbackNote("Saved locally. Run ORBIT again to refresh your profile.")
                }}
              >
                I did this
              </button>
              <button
                type="button"
                className="orbit-btn--sm orbit-btn--caution"
                disabled={!primaryBlockTitle}
                onClick={() => {
                  pushBehaviorOutcome({ outcome: "ignored", topTitle: primaryBlockTitle })
                  nudgePolicyAfterIgnored()
                  pushDurationHintFromTitle(primaryBlockTitle)
                  setFeedbackNote(
                    "Saved as skipped. We nudged weights and duration hints locally — regenerate to apply.",
                  )
                }}
              >
                I skipped it
              </button>
            </div>
            {feedbackNote ? <p className="orbit-feedback-note">{feedbackNote}</p> : null}
          </div>

          {result.steps && result.steps.length > 0 ? (
            <div className="orbit-run-next">
              <div className="orbit-run-section-label">Concrete next moves</div>
              <ol className="orbit-run-next__list">
                {result.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}

      {result?.agents && (
        <details className="orbit-agent-details">
          <summary>Agent trace (audit)</summary>
          <pre className="orbit-agent-pre">{JSON.stringify(result.agents, null, 2)}</pre>
        </details>
      )}

      {result?.inputError && (
        <div className="orbit-input-error">
          <strong>{result.action}</strong>
          <p>{result.reason}</p>
          <ul>
            {result.steps?.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
