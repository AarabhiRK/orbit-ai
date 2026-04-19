import { useState } from "react"

/**
 * Local “sign-in” — display name only (no server auth). Unlocks streak + unified memory UX.
 */
export default function LoginOverlay({ onSubmit }) {
  const [name, setName] = useState("")

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "linear-gradient(145deg, #0f172a 0%, #1e293b 45%, #312e81 100%)",
        color: "#e2e8f0",
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          padding: 28,
          borderRadius: 16,
          background: "rgba(15, 23, 42, 0.85)",
          border: "1px solid rgba(148, 163, 184, 0.35)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", color: "#a5b4fc" }}>
          ORBIT · local session
        </div>
        <h1 style={{ margin: "10px 0 8px", fontSize: 26, fontWeight: 800 }}>Welcome back, builder</h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55, color: "#cbd5e1" }}>
          Choose a display name. We keep your runs, outcomes, hints, goals, and calendar on{" "}
          <strong>this device</strong> — daily streak tracks each day you open ORBIT.
        </p>
        <label style={{ display: "block", fontSize: 13, marginBottom: 6, color: "#94a3b8" }}>
          Display name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onSubmit(name.trim())
          }}
          placeholder="e.g. Alex"
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #475569",
            background: "#0f172a",
            color: "#f8fafc",
            fontSize: 16,
            marginBottom: 16,
          }}
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onSubmit(name.trim())}
          style={{
            width: "100%",
            padding: "14px 18px",
            borderRadius: 10,
            border: "none",
            background: name.trim() ? "linear-gradient(90deg, #6366f1, #8b5cf6)" : "#475569",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            cursor: name.trim() ? "pointer" : "not-allowed",
          }}
        >
          Enter dashboard
        </button>
      </div>
    </div>
  )
}
