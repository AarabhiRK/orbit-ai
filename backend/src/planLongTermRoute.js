import { ValidationError } from "./parseBody.js"
import { planLongTermGoalSteps } from "./goalStepsGemini.js"

/**
 * @param {Record<string, unknown>} body
 */
export async function handlePlanLongTermSteps(body) {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body must be a JSON object")
  }
  const goal = typeof body.goal === "string" ? body.goal.trim() : ""
  if (!goal) {
    throw new ValidationError("Provide `goal` (your long-term goal text).")
  }
  if (goal.length > 500) {
    throw new ValidationError("goal: max 500 characters.")
  }
  const shortTermContext =
    typeof body.shortTermContext === "string" ? body.shortTermContext.trim() : ""
  assertSingleLineContext("shortTermContext", shortTermContext, 220)

  const { steps, modelId } = await planLongTermGoalSteps({ goal, shortTermContext })
  return {
    steps,
    modelId,
    debug: { system: "orbit-goal-planner", narrative_source: "gemini" },
  }
}

function assertSingleLineContext(label, raw, maxLen) {
  if (!raw) return
  if (raw.includes("\n") || raw.includes("\r")) {
    throw new ValidationError(`${label}: one line only.`)
  }
  if (raw.length > maxLen) {
    throw new ValidationError(`${label}: max ${maxLen} characters.`)
  }
}
