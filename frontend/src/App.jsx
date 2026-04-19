import { useState } from "react";

export default function App() {
  const [tasks, setTasks] = useState("");
  const [mood, setMood] = useState("");
  const [time, setTime] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [goals, setGoals] = useState("");

  const generate = async () => {
  setLoading(true);
  setResult(null);

  try {
    const res = await fetch("http://localhost:5000/generate-next-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks, mood, time, goals }),
    });

    const data = await res.json();
    setResult(data);
  } catch (err) {
    setResult({
      action: "Backend not connected yet",
      reason: "We still need to start the server",
      steps: ["Start backend", "Connect API", "Retry"],
      risk: "System incomplete",
      future_impact: "Cannot generate predictions without backend",
      confidence: 0,
    });
  }

  setLoading(false);
};

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif" }}>
      
      <h1 style={{ fontSize: 32, fontWeight: "bold" }}>ORBIT AI</h1>
      <p style={{ marginBottom: 20 }}>Your execution agent</p>
      <p style={{ fontSize: 12, color: "gray", marginBottom: 20 }}>
        System: {!result ? "Idle" : result.confidence === 0 ? "Offline / Mock Mode" : "AI Active"}
      </p>

      <textarea
        placeholder="Enter tasks..."
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setTasks(e.target.value)}
      />

      <textarea
        placeholder="Enter your goals (e.g., get internship, do well in classes)"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setGoals(e.target.value)}
      />

      <input
        placeholder="Mood (1-5 or text)"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setMood(e.target.value)}
      />

      <input
        placeholder="Time available (minutes)"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        onChange={(e) => setTime(e.target.value)}
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
        {loading ? "Thinking..." : "Generate Next Action"}
      </button>

      {loading && (
        <p style={{ marginTop: 20, fontStyle: "italic" }}>
          ORBIT is analyzing your context...
        </p>
      )}

      {result && (
        <div style={{ marginTop: 30, padding: 20, border: "1px solid #ddd" }}>
          
          <h2>Next Action</h2>
          <h3 style={{ fontSize: 20, fontWeight: "bold" }} >
            {result.action}
          </h3>

          <p><b>Reason:</b> {result.reason}</p>

          <p><b>Risk:</b> {result.risk}</p>

          <p><b>Future Impact:</b> {result.future_impact}</p>
          
          <p><b>Confidence:</b> {result.confidence}%</p>

          <h4>Steps:</h4>
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