import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// health check
app.get("/", (_req, res) => {
  res.send("ORBIT backend is running 🚀");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    system: "ORBIT AI backend online",
  });
});

// main orbit route
app.post("/generate-next-action", (req, res) => {
  try {
    const { tasks, mood, time, goals } = req.body;

    // temperorary stub, AI agent pipeline later
    return res.json({
      action: "Start CS178 homework (25 min)",
      steps: [
        "Open assignment",
        "Complete first problem",
        "Review solution"
      ],
      reason: "High urgency + aligns with academic goals",
      risk: "Delay will increase stress tomorrow",
      future_impact: "Finishing now frees time for internship applications later",
      confidence: 90,

      // 🔥 DEBUG (useful for demo transparency)
      debug: {
        received: {
          tasks,
          mood,
          time,
          goals
        },
        system: "stub-mode"
      }
    });

  } catch (err) {
    console.error("ORBIT ERROR:", err);

    return res.status(500).json({
      error: "Something went wrong in ORBIT backend",
      system: "failure",
    });
  }
});

app.listen(5000, () => {
  console.log("ORBIT server running on http://localhost:5000 🚀");
});