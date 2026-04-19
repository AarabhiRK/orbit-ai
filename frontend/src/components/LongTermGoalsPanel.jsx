import { useState } from "react"
import { addDaysToYmd, appendCalendarTasks, newId, saveCalendar, saveLongTermGoals, ymdFromDate } from "../lib/orbitLocalStore.js"

export default function LongTermGoalsPanel({
  goals,
  setGoals,
  calendar,
  setCalendar,
  shortTermGoals,
  apiBase,
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
      const res = await fetch(`${apiBase}/plan-long-term-steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const steps = (data.steps ?? []).map((s) => ({
        id: newId("st"),
        title: s.title,
        dayOffset: s.dayOffset ?? 0,
        done: false,
      }))
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
    <div
      style={{
        padding: 20,
        borderRadius: 14,
        border: "1px solid #e2e8f0",
        background: "linear-gradient(180deg, #fafbff 0%, #fff 40%)",
      }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: 20, color: "#0f172a" }}>Long-term goals</h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
        Add ambitions here — ORBIT uses them in scoring. Ask Gemini for a step ladder, drop steps onto the
        calendar, or append unchecked steps as task lines for the next run.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New goal (e.g. Ship portfolio site)"
          maxLength={200}
          style={{ flex: "1 1 220px", padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <button
          type="button"
          onClick={addGoal}
          disabled={!draft.trim()}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "#312e81",
            color: "#fff",
            fontWeight: 600,
            cursor: draft.trim() ? "pointer" : "not-allowed",
          }}
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
          <div
            key={g.id}
            style={{
              padding: 14,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "#fff",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
              <div>
                <div style={{ fontWeight: 700, color: "#1e293b" }}>{g.text}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  since {new Date(g.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeGoal(g.id)}
                style={{ fontSize: 12, color: "#64748b", border: "none", background: "transparent", cursor: "pointer" }}
              >
                Remove
              </button>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                onClick={() => planSteps(g)}
                disabled={planningId === g.id}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #6366f1",
                  background: "#eef2ff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: planningId === g.id ? "wait" : "pointer",
                }}
              >
                {planningId === g.id ? "Planning…" : "Plan steps (Gemini)"}
              </button>
              <button
                type="button"
                onClick={() => addStepsToCalendar(g)}
                disabled={!g.steps?.length}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #0ea5e9",
                  background: "#f0f9ff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: g.steps?.length ? "pointer" : "not-allowed",
                }}
              >
                Add steps to calendar
              </button>
              <button
                type="button"
                onClick={() => appendStepsToTasks(g)}
                disabled={!g.steps?.length}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #059669",
                  background: "#ecfdf5",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: g.steps?.length ? "pointer" : "not-allowed",
                }}
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
