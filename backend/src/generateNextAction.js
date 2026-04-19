import { parseGenerateBody } from "./parseBody.js"
import { normalizeTasksFromLines } from "./normalizeTasks.js"
import { ORBIT_WEIGHTS } from "./constants.js"
import { confidencePercent, scoreTasks } from "./scoring.js"
import { formatSentinelRiskLine, sentinelDeferSnapshot } from "./sentinel.js"
import { polishOrbitNarrative } from "./geminiNarrative.js"

function round4(n) {
  return Math.round(n * 10_000) / 10_000
}

function buildSteps(task) {
  const est = Math.max(5, Math.min(task.estimatedMinutes, 180))
  const first = Math.min(25, est)
  return [
    `Time-box ${first} minutes; single concrete output only`,
    `Work only on: ${task.title.slice(0, 80)}${task.title.length > 80 ? "…" : ""}`,
    `Stop when the timer ends; reschedule remainder if needed`,
  ]
}

/**
 * @param {Record<string, unknown>} body
 */
export async function generateNextAction(body) {
  const parsed = parseGenerateBody(body)
  const lines = parsed.tasksRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const tasks = normalizeTasksFromLines(lines)
  const asOfMs = parsed.asOfIso ? Date.parse(parsed.asOfIso) : Date.now()
  const asOfIso = new Date(asOfMs).toISOString()

  const rows = scoreTasks(tasks, {
    asOfIso,
    goalsRaw: parsed.goalsRaw,
    timeAvailableMinutes: parsed.timeAvailableMinutes,
    energy: parsed.energy,
  })

  const best = rows[0]
  const second = rows[1]
  const conf = confidencePercent(best, second)

  const sentinel = sentinelDeferSnapshot({
    tasks,
    chosenTaskId: best.task.id,
    asOfMs,
    goalsRaw: parsed.goalsRaw,
    timeAvailableMinutes: parsed.timeAvailableMinutes,
    energy: parsed.energy,
  })

  const est = best.task.estimatedMinutes
  const action = `Start: ${best.task.title} (~${est} min)`

  const reason = `ORBIT score ${round4(best.orbitScore)} (urgency ${round4(best.urgency)}, goal fit ${round4(best.goalAlignment)}, feasibility ${round4(best.feasibility)}); energy treated as ${parsed.energy}.`

  const futureImpact =
    sentinel.workloadRatio > 1
      ? `Clearing this now reduces pressure vs a ${sentinel.workloadRatio.toFixed(2)}× workload-to-time stack.`
      : `Completing this now keeps slack above a ${(1 / Math.max(sentinel.workloadRatio, 0.01)).toFixed(2)}× buffer vs total estimates.`

  const payload = {
    action,
    steps: buildSteps(best.task),
    reason,
    risk: formatSentinelRiskLine(sentinel, parsed.memoryRecent),
    future_impact: futureImpact,
    confidence: conf,
    orbit: {
      asOf: asOfIso,
      weights: { ...ORBIT_WEIGHTS },
      ranked: rows.map((r) => ({
        id: r.task.id,
        title: r.task.title,
        dueAt: r.task.dueAt,
        estimatedMinutes: r.task.estimatedMinutes,
        urgency: round4(r.urgency),
        goalAlignment: round4(r.goalAlignment),
        feasibility: round4(r.feasibility),
        orbitScore: round4(r.orbitScore),
      })),
    },
    sentinel: {
      deferHours: sentinel.deferHours,
      meanUrgencyNow: round4(sentinel.meanUrgencyNow),
      meanUrgencyIfDeferChosen: round4(sentinel.meanUrgencyIfDeferChosen),
      meanUrgencyDelta: round4(sentinel.meanUrgencyDelta),
      workloadRatio: round4(sentinel.workloadRatio),
      scoreGapTop2: round4(sentinel.scoreGapTop2),
    },
    debug: {
      received: {
        tasks: body.tasks,
        mood: body.mood,
        time: body.time,
        goals: body.goals,
        shortTermGoals: body.shortTermGoals,
        longTermGoals: body.longTermGoals,
        memory: { recentRuns: parsed.memoryRecent },
        asOf: body.asOf,
      },
      system: "orbit-core",
    },
  }

  if (process.env.GEMINI_API_KEY?.trim()) {
    const polished = await polishOrbitNarrative(payload)
    payload.debug = {
      ...payload.debug,
      narrative_source: polished ? "gemini" : "orbit-core",
      llm: polished
        ? { provider: "gemini", model: polished.modelId, ok: true }
        : {
            provider: "gemini",
            ok: false,
            fallback: "orbit-core",
            note: "timeout_parse_empty_or_api_error",
          },
    }
    if (polished) {
      payload.reason = polished.reason
      payload.risk = polished.risk
      payload.future_impact = polished.future_impact
    }
    // if !polished: reason / risk / future_impact stay the deterministic strings above
  }

  return payload
}
