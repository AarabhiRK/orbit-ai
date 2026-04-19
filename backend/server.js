// Load backend/.env before anything else reads process.env (including GEMINI_API_KEY).
import "dotenv/config"
import express from "express"
import cors from "cors"
import { ValidationError } from "./src/parseBody.js"
import { generateNextAction } from "./src/generateNextAction.js"

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
  })
})

app.post("/generate-next-action", async (req, res) => {
  try {
    const payload = await generateNextAction(req.body ?? {})
    return res.json(payload)
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message })
    }
    console.error("ORBIT ERROR:", err)
    return res.status(500).json({
      error: "Something went wrong in ORBIT backend",
      system: "failure",
    })
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
