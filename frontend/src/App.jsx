import { useState } from "react";

const apiBase = (import.meta.env.VITE_API_URL ?? "http://localhost:5050").replace(
  /\/$/,
  "",
);

const ORBIT_MEMORY_KEY = "orbit_v1_session_memory"

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

function rememberRun(data) {
  try {
    const prev = loadSessionMemory()
    const runs = Array.isArray(prev.recentRuns) ? [...prev.recentRuns] : []
    runs.unshift({
      at: new Date().toISOString(),
      action: data.action ?? "",
      topTitle: data.orbit?.ranked?.[0]?.title ?? "",
      orbitScoreTop: data.orbit?.ranked?.[0]?.orbitScore ?? null,
    })
    localStorage.setItem(
      ORBIT_MEMORY_KEY,
      JSON.stringify({ recentRuns: runs.slice(0, 8) }),
    )
  } catch {
    /* ignore quota / privacy mode */
  }
}

export default function App() {
  const [tasks, setTasks] = useState("");
  const [mood, setMood] = useState("");
  const [time, setTime] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shortTermGoals, setShortTermGoals] = useState("");
  const [longTermGoals, setLongTermGoals] = useState("");

  const generate = async () => {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${apiBase}/generate-next-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks,
          mood,
          time,
          shortTermGoals,
          longTermGoals,
          memory: loadSessionMemory(),
        }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = { error: `Invalid response from server (${res.status})` };
      }

      if (!res.ok) {
        setResult({
          action: "Could not generate next action",
          reason:
            typeof data.error === "string"
              ? data.error
              : `Server error (${res.status})`,
          steps: ["Check tasks (one per line)", "Set time available > 0", "Retry"],
          risk: "—",
          future_impact: "—",
          confidence: 50,
          inputError: true,
        });
        return;
      }
      setResult(data);
      rememberRun(data);
    } catch {
      setResult({
        action: "Backend not connected yet",
        reason: "We still need to start the server",
        steps: ["Start backend", "Connect API", "Retry"],
        risk: "System incomplete",
        future_impact: "Cannot generate predictions without backend",
        confidence: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif" }}>
      
      <h1 style={{ fontSize: 32, fontWeight: "bold" }}>ORBIT AI</h1>
      <p style={{ marginBottom: 20 }}>Your execution agent</p>
      {import.meta.env.DEV && (
        <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
          Dev: open this app from the Vite URL (usually{" "}
          <code style={{ fontSize: 11 }}>http://localhost:5173</code>
          ). API base: <code style={{ fontSize: 11 }}>{apiBase}</code>
        </p>
      )}
      <p style={{ fontSize: 12, color: "gray", marginBottom: 20 }}>
        System:{" "}
        {!result
          ? "Idle"
          : result.inputError
            ? "Input / validation"
            : result.confidence === 0
              ? "Offline / API unreachable"
              : "ORBIT active"}
      </p>

      <textarea
        placeholder="Tasks: one per line, or several on one line separated by commas (e.g. CS homework, dishes). ORBIT picks one winner. Optional per line: est:90 due:2026-04-22. Time field: minutes or phrases like 2 hours, 90 min."
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setTasks(e.target.value)}
        value={tasks}
      />

      <textarea
        placeholder="Short-term goals (this week / month)"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setShortTermGoals(e.target.value)}
        value={shortTermGoals}
      />

      <textarea
        placeholder="Long-term goals (internship, GPA, health, …)"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setLongTermGoals(e.target.value)}
        value={longTermGoals}
      />

      <input
        placeholder="Mood (1-5 or text)"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setMood(e.target.value)}
        value={mood}
      />

      <input
        placeholder="Time available (e.g. 90, 2 hours, 1h 30m)"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setTime(e.target.value)}
        value={time}
      />

      <button
        onClick={generate}
        disabled={loading}
        style={{
          padding: "10px 20px",
          background: loading ? "gray": "black",
          color: "white",
          border: "none",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "ORBIT thinking…" : "Generate Next Action"}
      </button>

      {loading && (
        <p style={{ marginTop: 20, fontStyle: "italic", color: "#555" }}>
          ORBIT is scoring tasks and running Sentinel…
        </p>
      )}

      {result && (
        <div style={{ marginTop: 30, padding: 20, border: "1px solid #ddd", textAlign: "left" }}>
          
          <h2 style={{ textAlign: "center", marginTop: 0 }}>Next Action</h2>

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
                <b>Chosen from your list</b>
                <p style={{ margin: "6px 0 0", color: "#64748b", lineHeight: 1.45 }}>
                  {result.orbit.ranked.length === 1
                    ? "You entered one task — that becomes the next action."
                    : `ORBIT scored ${result.orbit.ranked.length} tasks (one line each) and ranked them. The headline below is the single winner for right now.`}
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

          <h3
            style={{
              fontSize: 24,
              fontWeight: 700,
              lineHeight: 1.25,
              margin: "12px 0 16px",
              textAlign: "center",
            }}
          >
            {result.action}
          </h3>

          <p style={{ margin: "12px 0" }}>
            <b>Reason</b> <span style={{ color: "#555", fontWeight: 500 }}>(auditable)</span>
            <br />
            {result.reason}
          </p>

          <div
            style={{
              margin: "16px 0",
              padding: "12px 14px",
              borderLeft: "4px solid #b91c1c",
              background: "#fef2f2",
              color: "#1f2937",
            }}
          >
            <b>Risk</b> <span style={{ color: "#991b1b" }}>(Sentinel)</span>
            <div style={{ marginTop: 6 }}>{result.risk}</div>
          </div>

          <p style={{ margin: "14px 0", fontSize: 14, color: "#64748b", lineHeight: 1.45 }}>
            <b style={{ color: "#475569" }}>Future impact</b>
            <br />
            {result.future_impact}
          </p>
          
          <p style={{ margin: "12px 0", fontSize: 15 }}>
            <b>Confidence</b> (top vs runner-up): {result.confidence}%
          </p>

          <h4>Steps</h4>
          <ul>
            {result?.steps?.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}