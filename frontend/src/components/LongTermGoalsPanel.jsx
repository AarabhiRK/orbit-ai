import { useState } from "react"
import { addDaysToYmd, appendCalendarTasks, newId, saveCalendar, saveLongTermGoals, ymdFromDate } from "../lib/orbitLocalStore.js"

export default function LongTermGoalsPanel({
  goals,
  setGoals,
  calendar,
  setCalendar,
  shortTermGoals,
  apiBase,
  accessToken,
  tasks,
  setTasks,
}) {
  const [draft, setDraft] = useState("")
  const [planningId, setPlanningId] = useState(null)
  const [planError, setPlanError] = useState("")

  const persistGoals = (next) => {
    setGoals(next)
    saveLongTermGoals(next)
  }

  const addGoal = () => {
    const text = draft.trim()
    if (!text || text.length > 200) return
    const row = {
      id: newId("lt"),
      text,
      createdAt: new Date().toISOString(),
      steps: [],
      archived: false,
    }
    const next = [row, ...goals]
    setDraft("")
    persistGoals(next)
  }

  const removeGoal = (id) => {
    persistGoals(goals.filter((g) => g.id !== id))
  }

  const planSteps = async (goalRow) => {
    setPlanError("")
    setPlanningId(goalRow.id)
    try {
      const headers = { "Content-Type": "application/json" }
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`
      const res = await fetch(`${apiBase}/plan-long-term-steps`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          goal: goalRow.text,
          shortTermContext: shortTermGoals?.trim() ?? "",
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPlanError(data.error ?? `Planner error (${res.status})`)
        return
      }
      const raw = Array.isArray(data.steps) ? data.steps : []
      const steps = raw
        .filter((s) => s && String(s.title ?? "").trim().length >= 3)
        .map((s) => {
          const off = Number(s.dayOffset)
          return {
            id: newId("st"),
            title: String(s.title).trim().slice(0, 200),
            dayOffset: Number.isFinite(off) ? Math.min(13, Math.max(0, Math.round(off))) : 0,
            done: false,
          }
        })
      if (steps.length < 4) {
        setPlanError(
          `Planner returned too few steps (${steps.length}; need at least 4). Try "Plan steps" again.`,
        )
        return
      }
      const next = goals.map((g) => (g.id === goalRow.id ? { ...g, steps } : g))
      persistGoals(next)
    } catch {
      setPlanError("Could not reach planner — is the backend running?")
    } finally {
      setPlanningId(null)
    }
  }

  const addStepsToCalendar = (goalRow) => {
    const base = ymdFromDate()
    const entries = []
    for (const s of goalRow.steps || []) {
      if (s.done) continue
      entries.push({
        ymd: addDaysToYmd(base, s.dayOffset ?? 0),
        title: s.title,
        source: "goal",
      })
    }
    if (entries.length === 0) return
    const nextCal = appendCalendarTasks(calendar, entries)
    setCalendar(nextCal)
    saveCalendar(nextCal)
  }

  const appendStepsToTasks = (goalRow) => {
    const lines = (goalRow.steps || [])
      .filter((s) => !s.done)
      .map((s) => `${s.title} est:45`)
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

  return (
    <div className="orbit-panel orbit-panel--soft">
      <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>Long-term goals</h2>
      <p className="orbit-muted-label" style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
        Add ambitions here — ORBIT uses them in scoring. Use <strong>Plan steps</strong> for a suggested
        ladder, drop steps onto the calendar, or append unchecked steps as task lines for the next run.
      </p>

      <div className="orbit-lt-flex-row">
        <input
          className="orbit-field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New goal (e.g. Ship portfolio site)"
          maxLength={200}
        />
        <button
          type="button"
          className="orbit-btn orbit-btn--primary orbit-btn--compact"
          onClick={addGoal}
          disabled={!draft.trim()}
        >
          Save goal
        </button>
      </div>

      {planError && (
        <p style={{ color: "#b91c1c", fontSize: 13, marginBottom: 12 }}>{planError}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {goals.length === 0 && (
          <p style={{ color: "#94a3b8", fontSize: 14 }}>No long-term goals yet — add one above.</p>
        )}
        {goals.map((g) => (
          <div key={g.id} className="orbit-lt-goal">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
              <div>
                <div style={{ fontWeight: 700, color: "#1e293b" }}>{g.text}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  since {new Date(g.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button type="button" className="orbit-link-btn" onClick={() => removeGoal(g.id)}>
                Remove
              </button>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="orbit-btn--outline orbit-btn--outline-indigo"
                onClick={() => planSteps(g)}
                disabled={planningId === g.id}
                style={{ cursor: planningId === g.id ? "wait" : "pointer" }}
              >
                {planningId === g.id ? "Planning…" : "Plan steps (Gemini)"}
              </button>
              <button
                type="button"
                className="orbit-btn--outline orbit-btn--outline-sky"
                onClick={() => addStepsToCalendar(g)}
                disabled={!g.steps?.length}
              >
                Add steps to calendar
              </button>
              <button
                type="button"
                className="orbit-btn--outline orbit-btn--outline-emerald"
                onClick={() => appendStepsToTasks(g)}
                disabled={!g.steps?.length}
              >
                Append to task list
              </button>
            </div>
            {g.steps?.length > 0 && (
              <ol style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: 13, lineHeight: 1.55, color: "#334155" }}>
                {g.steps.map((s) => (
                  <li key={s.id}>
                    <strong>D+{s.dayOffset}</strong> · {s.title}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
