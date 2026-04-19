import "./loadEnv.js"
import express from "express"
import cors from "cors"
import { ValidationError } from "./src/parseBody.js"
import {
  GeminiConfigurationError,
  GeminiNarrativeError,
} from "./src/orbitErrors.js"
import { generateNextAction } from "./src/generateNextAction.js"
import { generateSchedule } from "./src/generateSchedule.js"
import { handlePlanLongTermSteps } from "./src/planLongTermRoute.js"
import { getSupabaseEnvDebug, isSupabaseConfigured } from "./src/authSupabase.js"
import { registerMeRoutes } from "./src/meRoutes.js"

const app = express()
app.use(cors())
app.use(express.json())

// Default 5050: macOS AirPlay Receiver often occupies 5000, which breaks local dev.
const PORT = Number(process.env.PORT) || 5050

app.get("/", (_req, res) => {
  res.type("text/plain").send("ORBIT backend is running 🚀")
})

app.get("/health", (_req, res) => {
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim())
  res.json({
    ok: true,
    status: "ok",
    service: "orbit-backend",
    system: "ORBIT AI backend online",
    gemini_configured: geminiConfigured,
    gemini_required_for_orbit_routes: false,
    supabase_configured: isSupabaseConfigured(),
    supabase_env: getSupabaseEnvDebug(),
  })
})

if (isSupabaseConfigured()) {
  registerMeRoutes(app)
}

function handleOrbitError(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message })
  }
  if (err instanceof GeminiConfigurationError) {
    return res.status(503).json({
      error: err.message,
      system: "gemini_required",
      code: err.code,
    })
  }
  if (err instanceof GeminiNarrativeError) {
    return res.status(502).json({
      error: err.message,
      system: "gemini_narrative_failed",
      code: err.code,
    })
  }
  console.error("ORBIT ERROR:", err)
  return res.status(500).json({
    error: "Something went wrong in ORBIT backend",
    system: "failure",
  })
}

app.post("/generate-next-action", async (req, res) => {
  try {
    const payload = await generateNextAction(req.body ?? {})
    return res.json(payload)
  } catch (err) {
    return handleOrbitError(res, err)
  }
})

app.post("/generate-schedule", async (req, res) => {
  try {
    const payload = await generateSchedule(req.body ?? {})
    return res.json(payload)
  } catch (err) {
    return handleOrbitError(res, err)
  }
})

app.post("/plan-long-term-steps", async (req, res) => {
  try {
    const payload = await handlePlanLongTermSteps(req.body ?? {})
    return res.json(payload)
  } catch (err) {
    return handleOrbitError(res, err)
  }
})

const server = app.listen(PORT)

server.once("listening", () => {
  console.log(`ORBIT server running on http://localhost:${PORT} 🚀`)
})

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[ORBIT] Port ${PORT} is already in use. Try another port, e.g. PORT=5051 npm start\n` +
        `(If you use a non-default port, set VITE_API_URL in frontend/.env.development.local to match.)`,
    )
  } else {
    console.error("[ORBIT] Server error:", err)
  }
  process.exit(1)
})
