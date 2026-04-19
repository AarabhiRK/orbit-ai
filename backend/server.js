import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import { ValidationError } from "./src/parseBody.js"
import { generateNextAction } from "./src/generateNextAction.js"

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const PORT = Number(process.env.PORT) || 5000

app.get("/", (_req, res) => {
  res.type("text/plain").send("ORBIT backend is running 🚀")
})

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "ok",
    service: "orbit-backend",
    system: "ORBIT AI backend online",
  })
})

app.post("/generate-next-action", (req, res) => {
  try {
    const payload = generateNextAction(req.body ?? {})
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

app.listen(PORT, () => {
  console.log(`ORBIT server running on http://localhost:${PORT} 🚀`)
})
