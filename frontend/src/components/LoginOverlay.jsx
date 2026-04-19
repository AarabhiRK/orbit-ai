import { useState } from "react"
import { loadLastAuthEmail } from "../lib/orbitLocalStore.js"

/**
 * Email + password auth via Supabase (cross-device). Create account sets display name in user metadata.
 */
export default function LoginOverlay({
  onSignIn,
  onSignUp,
  busy,
  errorText,
  onDismissError,
  supabaseMissing,
}) {
  const [mode, setMode] = useState("signin")
  const [email, setEmail] = useState(() => loadLastAuthEmail())
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")

  if (supabaseMissing) {
    return (
      <div className="orbit-login-backdrop">
        <div className="orbit-login-card orbit-login-card--wide">
          <h1>Supabase not configured in the frontend</h1>
          <p className="orbit-login-lede" style={{ marginBottom: 12 }}>
            Add to <code style={{ color: "#fca5a5" }}>frontend/.env.development.local</code>:
          </p>
          <pre className="orbit-login-pre">
            {`VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_public_key`}
          </pre>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 14 }}>
            Backend also needs <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>, and{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>backend/.env</code>. Restart both servers after saving.
          </p>
        </div>
      </div>
    )
  }

  const submit = () => {
    if (mode === "signin") {
      onSignIn({ email: email.trim(), password })
    } else {
      onSignUp({
        email: email.trim(),
        password,
        displayName: displayName.trim() || email.trim().split("@")[0] || "ORBIT user",
      })
    }
  }

  const canSubmit = email.trim().length > 3 && password.length >= 6

  return (
    <div className="orbit-login-backdrop">
      <div className="orbit-login-card">
        <div className="orbit-login-eyebrow">ORBIT</div>
        <h1>Sign in to your dashboard</h1>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: 4 }}>
          <button
            type="button"
            className={`orbit-login-toggle${mode === "signin" ? " orbit-login-toggle--active" : ""}`}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`orbit-login-toggle${mode === "signup" ? " orbit-login-toggle--active" : ""}`}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

        {errorText ? (
          <div role="alert" aria-live="polite" className="orbit-login-error">
            <p style={{ margin: "0 0 8px", lineHeight: 1.45 }}>{errorText}</p>
            {onDismissError ? (
              <button type="button" className="orbit-login-error-dismiss" onClick={onDismissError}>
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}

        <label className="orbit-login-label">Email</label>
        <input
          autoComplete="email"
          className="orbit-login-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@university.edu"
          style={{ marginBottom: 12 }}
        />

        <label className="orbit-login-label">Password (min 6)</label>
        <input
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className="orbit-login-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit && !busy) submit()
          }}
          style={{ marginBottom: 12 }}
        />

        {mode === "signup" && (
          <>
            <label className="orbit-login-label">Display name</label>
            <input
              autoComplete="nickname"
              className="orbit-login-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How ORBIT greets you in the header"
              style={{ marginBottom: 16 }}
            />
          </>
        )}

        <button
          type="button"
          className="orbit-login-submit"
          disabled={!canSubmit || busy}
          onClick={submit}
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account & continue"}
        </button>
      </div>
    </div>
  )
}
