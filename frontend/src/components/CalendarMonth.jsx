import { useMemo, useState } from "react"
import { appendCalendarTasks, saveCalendar, ymdFromDate } from "../lib/orbitLocalStore.js"

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function ymdFromParts(year, monthIndex, day) {
  const m = String(monthIndex + 1).padStart(2, "0")
  const d = String(day).padStart(2, "0")
  return `${year}-${m}-${d}`
}

export default function CalendarMonth({ calendar, setCalendar, onAppendTasksFromCalendar }) {
  const now = new Date()
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })

  const { year, monthIndex, cells } = useMemo(() => {
    const year = cursor.y
    const monthIndex = cursor.m
    const first = new Date(year, monthIndex, 1)
    const startPad = first.getDay()
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < startPad; i++) {
      cells.push({ type: "pad" })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ type: "day", day: d, ymd: ymdFromParts(year, monthIndex, d) })
    }
    return { year, monthIndex, cells }
  }, [cursor])

  const [addTitle, setAddTitle] = useState("")
  const [addYmd, setAddYmd] = useState(ymdFromDate())

  const persist = (next) => {
    setCalendar(next)
    saveCalendar(next)
  }

  const toggleDone = (ymd, taskId) => {
    const list = (calendar[ymd] || []).map((t) =>
      t.id === taskId ? { ...t, done: !t.done } : t,
    )
    persist({ ...calendar, [ymd]: list })
  }

  const removeTask = (ymd, taskId) => {
    const list = (calendar[ymd] || []).filter((t) => t.id !== taskId)
    const next = { ...calendar }
    if (list.length) next[ymd] = list
    else delete next[ymd]
    persist(next)
  }

  const addManual = () => {
    const title = addTitle.trim()
    if (!title) return
    const next = appendCalendarTasks(calendar, [{ ymd: addYmd, title, source: "manual" }])
    persist(next)
    setAddTitle("")
  }

  const label = new Date(year, monthIndex, 1).toLocaleString(undefined, { month: "long", year: "numeric" })

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 14,
        border: "1px solid #e2e8f0",
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>Life calendar</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => {
              const d = new Date(year, monthIndex - 1, 1)
              setCursor({ y: d.getFullYear(), m: d.getMonth() })
            }}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc" }}
          >
            ←
          </button>
          <span style={{ fontWeight: 700, minWidth: 160, textAlign: "center", color: "#334155" }}>{label}</span>
          <button
            type="button"
            onClick={() => {
              const d = new Date(year, monthIndex + 1, 1)
              setCursor({ y: d.getFullYear(), m: d.getMonth() })
            }}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc" }}
          >
            →
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 14, lineHeight: 1.5 }}>
        Check off what you did. Push unchecked items into your ORBIT task list when you are ready to score them.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 6,
          marginBottom: 18,
        }}
      >
        {WEEK.map((w) => (
          <div key={w} style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "center" }}>
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (c.type === "pad") {
            return <div key={`p-${i}`} />
          }
          const tasks = calendar[c.ymd] || []
          const isToday = c.ymd === ymdFromDate()
          return (
            <div
              key={c.ymd}
              style={{
                minHeight: 108,
                borderRadius: 10,
                border: isToday ? "2px solid #6366f1" : "1px solid #e2e8f0",
                padding: 6,
                background: isToday ? "#f5f3ff" : "#fafafa",
                overflow: "hidden",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: isToday ? "#4338ca" : "#64748b" }}>{c.day}</div>
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                {tasks.slice(0, 4).map((t) => (
                  <label
                    key={t.id}
                    style={{
                      display: "flex",
                      gap: 4,
                      alignItems: "flex-start",
                      fontSize: 10,
                      lineHeight: 1.25,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!t.done}
                      onChange={() => toggleDone(c.ymd, t.id)}
                      style={{ marginTop: 2 }}
                    />
                    <span
                      style={{
                        textDecoration: t.done ? "line-through" : "none",
                        opacity: t.done ? 0.55 : 1,
                        wordBreak: "break-word",
                      }}
                    >
                      {t.title}
                    </span>
                  </label>
                ))}
                {tasks.length > 4 && (
                  <span style={{ fontSize: 9, color: "#94a3b8" }}>+{tasks.length - 4} more</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          marginBottom: 14,
        }}
      >
        <strong style={{ fontSize: 13, color: "#334155" }}>Quick add</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input
            type="date"
            value={addYmd}
            onChange={(e) => setAddYmd(e.target.value)}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
          />
          <input
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="Task title"
            style={{ flex: "1 1 180px", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
          />
          <button
            type="button"
            onClick={addManual}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "#0f172a",
              color: "#fff",
              fontWeight: 600,
              cursor: addTitle.trim() ? "pointer" : "not-allowed",
            }}
            disabled={!addTitle.trim()}
          >
            Add to day
          </button>
        </div>
      </div>

      <details style={{ fontSize: 13, color: "#475569" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>All tasks this month (edit / remove)</summary>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {cells
            .filter((c) => c.type === "day")
            .flatMap((c) => (calendar[c.ymd] || []).map((t) => ({ ymd: c.ymd, t })))
            .filter(({ ymd }) => {
              const [y, m] = ymd.split("-").map(Number)
              return y === year && m - 1 === monthIndex
            })
            .map(({ ymd, t }) => (
              <div
                key={`${ymd}-${t.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 8,
                  background: "#fff",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              >
                <input type="checkbox" checked={!!t.done} onChange={() => toggleDone(ymd, t.id)} />
                <span style={{ flex: 1 }}>
                  <strong>{ymd}</strong> · {t.title}{" "}
                  <span style={{ color: "#94a3b8" }}>({t.source})</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeTask(ymd, t.id)}
                  style={{ fontSize: 12, border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer" }}
                >
                  Remove
                </button>
              </div>
            ))}
        </div>
      </details>

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={onAppendTasksFromCalendar}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #059669",
            background: "#ecfdf5",
            fontWeight: 700,
            color: "#065f46",
            cursor: "pointer",
          }}
        >
          Append unchecked calendar tasks to ORBIT list
        </button>
      </div>
    </div>
  )
}
