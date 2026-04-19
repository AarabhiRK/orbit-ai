import { useMemo, useState } from "react"
import LoginOverlay from "./components/LoginOverlay.jsx"
import LongTermGoalsPanel from "./components/LongTermGoalsPanel.jsx"
import CalendarMonth from "./components/CalendarMonth.jsx"
import {
  appendCalendarTasks,
  collectUncheckedCalendarTaskLines,
  exportMemoryBundle,
  loadCalendar,
  loadLongTermGoals,
  loadProfile,
  longTermGoalsToApiLine,
  saveCalendar,
  saveProfile,
  touchVisitStreak,
  ymdFromDate,
} from "./lib/orbitLocalStore.js"

const apiBase = (import.meta.env.VITE_API_URL ?? "http://localhost:5050").replace(
  /\/$/,
  "",
)

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

function formatClock(m) {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

function initialProfile() {
  const p = loadProfile()
  if (!p.displayName) return p
  const n = touchVisitStreak(p)
  if (
    n.lastVisitYmd !== p.lastVisitYmd ||
    n.currentStreak !== p.currentStreak ||
    n.longestStreak !== p.longestStreak
  ) {
    saveProfile(n)
    return n
  }
  return p
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
  const [profile, setProfile] = useState(initialProfile)
  const [goalRows, setGoalRows] = useState(loadLongTermGoals)
  const [calendar, setCalendar] = useState(loadCalendar)
  const [lifeTab, setLifeTab] = useState("run")

  const longTermGoalsForApi = useMemo(() => longTermGoalsToApiLine(goalRows), [goalRows])

  const handleLocalLogin = (displayName) => {
    const base = loadProfile()
    const withName = {
      ...base,
      displayName,
      joinedAt: base.joinedAt || new Date().toISOString(),
    }
    const next = touchVisitStreak(withName)
    saveProfile(next)
    setProfile(next)
  }

  const downloadMemoryExport = () => {
    const blob = new Blob([JSON.stringify(exportMemoryBundle(), null, 2)], {
      type: "application/json",
    })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `orbit-memory-${ymdFromDate()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
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

      const res = await fetch(`${apiBase}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    } catch {
      setResult({
        mode: "error",
        action: "Backend not connected",
        reason: "Start the ORBIT API server and retry.",
        steps: ["cd backend && npm start", "Confirm VITE_API_URL if not using :5050"],
        risk: "—",
        future_impact: "—",
        confidence: 0,
      })
    }

    setLoading(false)
  }

  const durationPredictions =
    result?.agents?.find((a) => a.id === "duration")?.output?.predictions ?? []

  const primaryBlockTitle =
    result?.schedule?.days?.[0]?.blocks?.[0]?.title ??
    result?.candidates_top_3?.[0]?.title ??
    ""

  if (!profile.displayName?.trim()) {
    return <LoginOverlay onSubmit={handleLocalLogin} />
  }

  return (
    <div style={{ maxWidth: 920, margin: "32px auto", fontFamily: "system-ui, sans-serif", padding: "0 16px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          padding: "14px 16px",
          borderRadius: 14,
          background: "linear-gradient(120deg, #1e1b4b 0%, #312e81 55%, #4c1d95 100%)",
          color: "#e0e7ff",
        }}
      >
        <div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Signed in locally as</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{profile.displayName}</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>Streak</div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{profile.currentStreak ?? 0}🔥</div>
          </div>
          <div style={{ textAlign: "center", opacity: 0.9 }}>
            <div style={{ fontSize: 11 }}>Best</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{profile.longestStreak ?? 0}</div>
          </div>
          <button
            type="button"
            onClick={downloadMemoryExport}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(15,23,42,0.35)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Export memory JSON
          </button>
          <button
            type="button"
            onClick={() => {
              const p = loadProfile()
              saveProfile({ ...p, displayName: "" })
              setProfile(loadProfile())
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.25)",
              background: "transparent",
              color: "#e0e7ff",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Switch user
          </button>
        </div>
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.02 }}>ORBIT AI</h1>
      <p style={{ color: "#475569", marginBottom: 8 }}>
        Personal life dashboard: goals, mood, and tasks → ranked next step or multi-day schedule, with Gemini
        copy on top of transparent ORBIT Core scoring.
      </p>
      {import.meta.env.DEV && (
        <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
          API: <code style={{ fontSize: 11 }}>{apiBase}</code>
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setLifeTab("run")}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: lifeTab === "run" ? "2px solid #0f172a" : "1px solid #cbd5e1",
            background: lifeTab === "run" ? "#0f172a" : "#fff",
            color: lifeTab === "run" ? "#fff" : "#334155",
            fontWeight: 600,
          }}
        >
          Run ORBIT
        </button>
        <button
          type="button"
          onClick={() => setLifeTab("calendar")}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: lifeTab === "calendar" ? "2px solid #0f172a" : "1px solid #cbd5e1",
            background: lifeTab === "calendar" ? "#0f172a" : "#fff",
            color: lifeTab === "calendar" ? "#fff" : "#334155",
            fontWeight: 600,
          }}
        >
          Calendar
        </button>
        <button
          type="button"
          onClick={() => setLifeTab("goals")}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: lifeTab === "goals" ? "2px solid #0f172a" : "1px solid #cbd5e1",
            background: lifeTab === "goals" ? "#0f172a" : "#fff",
            color: lifeTab === "goals" ? "#fff" : "#334155",
            fontWeight: 600,
          }}
        >
          Long-term goals
        </button>
      </div>

      {lifeTab === "calendar" && (
        <div style={{ marginBottom: 24 }}>
          <CalendarMonth
            calendar={calendar}
            setCalendar={setCalendar}
            onAppendTasksFromCalendar={appendCalendarLinesToTasks}
          />
        </div>
      )}

      {lifeTab === "goals" && (
        <div style={{ marginBottom: 24 }}>
          <LongTermGoalsPanel
            goals={goalRows}
            setGoals={setGoalRows}
            calendar={calendar}
            setCalendar={setCalendar}
            shortTermGoals={shortTermGoals}
            apiBase={apiBase}
            tasks={tasks}
            setTasks={setTasks}
          />
        </div>
      )}

      {lifeTab === "run" && (
        <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setMode("next_action")}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: mode === "next_action" ? "2px solid #0f172a" : "1px solid #cbd5e1",
            background: mode === "next_action" ? "#0f172a" : "#fff",
            color: mode === "next_action" ? "#fff" : "#334155",
            fontWeight: 600,
          }}
        >
          Next action (primary)
        </button>
        <button
          type="button"
          onClick={() => setMode("schedule")}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: mode === "schedule" ? "2px solid #0f172a" : "1px solid #cbd5e1",
            background: mode === "schedule" ? "#0f172a" : "#fff",
            color: mode === "schedule" ? "#fff" : "#334155",
            fontWeight: 600,
          }}
        >
          Multi-day schedule
        </button>
      </div>

      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
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
        placeholder="Tasks: one per line, or several on one line separated by commas (e.g. CS homework, dishes). Optional per line: est:45 due:2026-04-22 after:task_0. Time: minutes or phrases like 2 hours, 90 min."
        style={{ width: "100%", minHeight: 110, padding: 12, marginBottom: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
        onChange={(e) => setTasks(e.target.value)}
        value={tasks}
      />

      <textarea
        placeholder="Short-term goals — one line only, max 220 chars (1 short statement)"
        maxLength={220}
        style={{ width: "100%", minHeight: 56, padding: 12, marginBottom: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
        onChange={(e) => setShortTermGoals(e.target.value)}
        value={shortTermGoals}
      />

      {goalRows.length > 0 ? (
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10, lineHeight: 1.45 }}>
          <strong>Long-term</strong> (from Goals tab, sent to ORBIT):{" "}
          {longTermGoalsForApi || "—"}
        </p>
      ) : (
        <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Add long-term goals under the <strong>Long-term goals</strong> tab — they flow into scoring automatically.
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <input
          placeholder="Mood (1–5 or words)"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
          onChange={(e) => setMood(e.target.value)}
          value={mood}
        />
        <input
          placeholder={mode === "schedule" ? "Minutes / day (or e.g. 2h)" : "Time budget (e.g. 90, 2 hours, 1h 30m)"}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
          onChange={(e) => setTime(e.target.value)}
          value={time}
        />
        <input
          placeholder="Or hours (decimal)"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
          onChange={(e) => setHours(e.target.value)}
          value={hours}
        />
        {mode === "schedule" && (
          <>
            <input
              placeholder="Override min/day (optional)"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              onChange={(e) => setMinutesPerDay(e.target.value)}
              value={minutesPerDay}
            />
            <input
              placeholder="Horizon days (1–14)"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              onChange={(e) => setScheduleDays(e.target.value)}
              value={scheduleDays}
            />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={generate}
        disabled={loading}
        style={{
          padding: "12px 22px",
          background: loading ? "#94a3b8" : "#0f172a",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
          fontWeight: 600,
        }}
      >
        {loading ? "Running agents…" : mode === "schedule" ? "Build schedule" : "Get next action"}
      </button>

      {loading && (
        <p style={{ marginTop: 16, fontStyle: "italic", color: "#64748b" }}>
          User profile → durations → ORBIT core →{" "}
          {mode === "schedule" ? "scheduler → Sentinel…" : "Sentinel (×3) → LLM pick among top 3…"}
        </p>
      )}
        </>
      )}

      {lifeTab !== "run" && result && !result.inputError && (
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
          Last ORBIT result is below — switch to <strong>Run ORBIT</strong> to regenerate.
        </p>
      )}

      {result && !result.inputError && result.userModel && (
        <section
          style={{
            marginTop: 28,
            padding: 16,
            borderRadius: 12,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "#334155" }}>Who you seem to be (deterministic)</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#1e293b" }}>{result.userModel.summary}</p>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>
            Tags: {(result.userModel.tags || []).join(", ") || "—"}
          </p>
          {result.userModel?.behavior_profile && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#475569" }}>
              Behavior: completion{" "}
              {result.userModel.behavior_profile.completion_rate_0_100 ?? "—"}% · procrastination proxy{" "}
              {result.userModel.behavior_profile.procrastination_tendency_0_100 ?? "—"}/100 · focus-stability score{" "}
              {result.userModel.behavior_profile.focus_duration_pattern_score_0_100 ?? "—"}/100 · ignored logged{" "}
              {result.userModel.behavior_profile.ignored_recommendations_count ?? 0}
            </p>
          )}
        </section>
      )}

      {result && !result.inputError && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Plan headline</h2>
          {!result.inputError &&
            Array.isArray(result.orbit?.ranked) &&
            result.orbit.ranked.length > 0 && (
              <div
                style={{
                  marginBottom: 18,
                  padding: "12px 14px",
                  background: "#f8fafc",
                  borderRadius: 8,
                  fontSize: 14,
                  color: "#334155",
                }}
              >
                <b>How your tasks ranked</b>
                <p style={{ margin: "6px 0 0", color: "#64748b", lineHeight: 1.45 }}>
                  {result.orbit.ranked.length === 1
                    ? "One task — it becomes the next action."
                    : `ORBIT scored ${result.orbit.ranked.length} task(s) and ordered them. The headline below is the pick for right now.`}
                </p>
                {result.orbit.ranked.length > 1 && (
                  <ol style={{ margin: "10px 0 0", paddingLeft: 22, lineHeight: 1.5 }}>
                    {result.orbit.ranked.map((r, i) => (
                      <li
                        key={r.id ?? i}
                        style={{
                          fontWeight: i === 0 ? 600 : 400,
                          color: i === 0 ? "#0f172a" : "#475569",
                        }}
                      >
                        {r.title}
                        <span style={{ color: "#94a3b8", fontWeight: 400 }}>
                          {" "}
                          — orbit {r.orbitScore}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          <p style={{ fontSize: 17, fontWeight: 600, margin: "0 0 12px", lineHeight: 1.35 }}>{result.action}</p>
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={pinHeadlineToCalendar}
              disabled={!primaryBlockTitle}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #6366f1",
                background: "#eef2ff",
                fontWeight: 600,
                fontSize: 13,
                cursor: primaryBlockTitle ? "pointer" : "not-allowed",
              }}
            >
              Pin headline to today (calendar)
            </button>
          </div>
          {result.llm_selected_task_id && (
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>
              LLM choice among top-3 (validated):{" "}
              <code style={{ fontSize: 12 }}>{result.llm_selected_task_id}</code>
            </p>
          )}
          <p style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{result.reason}</p>
        </section>
      )}

      {result && !result.inputError && result.schedule && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Schedule by day</h2>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: -6, marginBottom: 14 }}>
            Times are minute offsets in your work window (00:00 = start of the block you protect for deep work).
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {result.schedule.days.map((day) => (
              <div
                key={day.dayIndex}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>
                  Day {day.dayIndex + 1} · {day.date}{" "}
                  <span style={{ fontWeight: 500, color: "#64748b", fontSize: 13 }}>
                    ({day.usedMinutes}/{day.capacityMinutes} min used)
                  </span>
                </div>
                {day.blocks.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: 14 }}>No blocks (overflow or empty).</div>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                    {day.blocks.map((b, i) => (
                      <li key={`${day.dayIndex}-${i}-${b.taskId}`}>
                        <strong>{formatClock(b.startMinuteInDay)}–{formatClock(b.endMinuteInDay)}</strong> ·{" "}
                        {b.title} <span style={{ color: "#64748b" }}>({b.minutes} min)</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
          {result.schedule.overflow?.length > 0 && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 8,
                background: "#fff7ed",
                border: "1px solid #fed7aa",
                color: "#9a3412",
                fontSize: 14,
              }}
            >
              <strong>Did not fit</strong>:{" "}
              {result.schedule.overflow.map((o) => `${o.title} (${o.unscheduledMinutes}m left)`).join("; ")}
            </div>
          )}
        </section>
      )}

      {result && !result.inputError && durationPredictions.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Duration agent</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "8px 6px" }}>Task</th>
                <th style={{ padding: "8px 6px" }}>Minutes</th>
                <th style={{ padding: "8px 6px" }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {durationPredictions.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 6px" }}>{p.title}</td>
                  <td style={{ padding: "8px 6px" }}>{p.minutes}</td>
                  <td style={{ padding: "8px 6px", color: "#64748b" }}>{p.source.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {result && !result.inputError && (
        <>
          <div
            style={{
              marginTop: 22,
              padding: 14,
              borderLeft: "4px solid #b91c1c",
              background: "#fef2f2",
              borderRadius: "0 8px 8px 0",
            }}
          >
            <b style={{ color: "#991b1b" }}>Risk</b> <span style={{ color: "#991b1b" }}>(Sentinel · first slot)</span>
            <div style={{ marginTop: 6, whiteSpace: "pre-line", color: "#1f2937" }}>{result.risk}</div>
          </div>
          <p style={{ marginTop: 16, fontSize: 14, color: "#475569", lineHeight: 1.5 }}>
            <b>Future impact</b>
            <br />
            {result.future_impact}
          </p>
          <p style={{ margin: "14px 0", fontSize: 15 }}>
            <b>Confidence</b> (composite): {result.confidence}%
            {result.confidence_margin_percent != null && (
              <span style={{ color: "#64748b", fontSize: 13 }}>
                {" "}
                · margin-only: {result.confidence_margin_percent}%
              </span>
            )}
          </p>
          {result.confidence_breakdown && (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                background: "#f1f5f9",
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <b>Confidence breakdown</b>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                <li>Data quality: {result.confidence_breakdown.data_confidence}</li>
                <li>Decision stability: {result.confidence_breakdown.decision_stability}</li>
                <li>Risk uncertainty (lower = riskier context): {result.confidence_breakdown.risk_uncertainty}</li>
              </ul>
              <p style={{ margin: "8px 0 0", color: "#64748b" }}>
                {result.confidence_breakdown.note}
              </p>
            </div>
          )}
          {result.alternatives && result.alternatives.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Alternative options</h3>
              <ul style={{ lineHeight: 1.5 }}>
                {result.alternatives.map((a) => (
                  <li key={a.id}>
                    <strong>{a.title}</strong> (score {a.orbitScore}) — {a.one_line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.tradeoffs && (
            <div style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Tradeoffs</h3>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#334155" }}>{result.tradeoffs}</p>
            </div>
          )}
          {result.schedule?.discarded_from_packing?.length > 0 && (
            <div
              style={{
                marginBottom: 16,
                padding: 10,
                background: "#fefce8",
                border: "1px solid #fde047",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <b>Auto-discarded from packing</b> (still in full rank list):{" "}
              {result.schedule.discarded_from_packing
                .map((d) => `${d.title} (${d.orbitScore?.toFixed?.(3) ?? d.orbitScore})`)
                .join("; ")}
            </div>
          )}
          <div
            style={{
              marginBottom: 20,
              padding: 12,
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#fff",
            }}
          >
            <b>Feedback loop</b> — log whether you followed the first block (updates behavior profile on next run).
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#475569" }}>
                First block: <em>{primaryBlockTitle || "—"}</em>
              </span>
              <button
                type="button"
                disabled={!primaryBlockTitle}
                onClick={() => {
                  pushBehaviorOutcome({ outcome: "done", topTitle: primaryBlockTitle })
                  setFeedbackNote("Logged as done (local). Regenerate to refresh profile.")
                }}
                style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #16a34a", background: "#f0fdf4" }}
              >
                Mark done
              </button>
              <button
                type="button"
                disabled={!primaryBlockTitle}
                onClick={() => {
                  pushBehaviorOutcome({ outcome: "ignored", topTitle: primaryBlockTitle })
                  nudgePolicyAfterIgnored()
                  pushDurationHintFromTitle(primaryBlockTitle)
                  setFeedbackNote(
                    "Logged as ignored. Policy weights + duration hints nudged locally — regenerate to apply.",
                  )
                }}
                style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #b45309", background: "#fffbeb" }}
              >
                Mark ignored
              </button>
            </div>
            {feedbackNote && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "#15803d" }}>{feedbackNote}</p>
            )}
          </div>
          <h3 style={{ fontSize: 16 }}>Next steps</h3>
          <ul style={{ lineHeight: 1.55 }}>
            {result?.steps?.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}

      {result?.agents && (
        <details style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "#334155" }}>
            Agent trace (audit)
          </summary>
          <pre
            style={{
              marginTop: 10,
              padding: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              borderRadius: 8,
              fontSize: 11,
              overflow: "auto",
              maxHeight: 420,
            }}
          >
            {JSON.stringify(result.agents, null, 2)}
          </pre>
        </details>
      )}

      {result?.inputError && (
        <div style={{ marginTop: 24, padding: 16, border: "1px solid #fecaca", borderRadius: 8, background: "#fef2f2" }}>
          <strong>{result.action}</strong>
          <p style={{ margin: "8px 0 0" }}>{result.reason}</p>
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
