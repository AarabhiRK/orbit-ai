import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

app.post("/generate-next-action", (_req, res) => {
  // Stub: ignores body until ORBIT scoring / LLM is wired.

  try {
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
      confidence: 90
    });

  } catch (err) {
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});