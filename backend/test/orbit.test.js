import test, { afterEach, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  __clearGoalStepsStub,
  __setGoalStepsStub,
} from "../src/goalStepsGemini.js"
import {
  __clearGeminiPolishStub,
  __setGeminiPolishStub,
} from "../src/geminiNarrative.js"
import { generateNextAction } from "../src/generateNextAction.js"
import { parseTaskLine, taskStringsFromRaw } from "../src/normalizeTasks.js"
import {
  ValidationError,
  parseGenerateBody,
  parseScheduleBody,
  parseTimeMinutes,
} from "../src/parseBody.js"
import {
  applyDurationPredictions,
  sanitizeDurationHints,
} from "../src/agents/durationAgent.js"
import { buildScheduleFromRanked } from "../src/agents/schedulerAgent.js"
import { planLongTermGoalSteps } from "../src/goalStepsGemini.js"
import { handlePlanLongTermSteps } from "../src/planLongTermRoute.js"
import { generateSchedule } from "../src/generateSchedule.js"
import { ORBIT_WEIGHTS } from "../src/constants.js"
import { buildBehaviorProfileSnapshot, sanitizeBehaviorOutcomes } from "../src/behaviorMemory.js"
import { formatSentinelRiskLine } from "../src/sentinel.js"
import { partitionScheduleRows } from "../src/scoring.js"

beforeEach(() => {
  __setGeminiPolishStub(async (payload) => ({
    reason: String(payload.reason ?? "Stub narrative reason.").slice(0, 500),
    future_impact: String(payload.future_impact ?? "Stub narrative future impact.").slice(0, 500),
    tradeoffs:
      payload.tradeoffs && String(payload.tradeoffs).length >= 20
        ? String(payload.tradeoffs)
        : "Compare #1 vs #2 vs #3 on urgency, goal fit, feasibility, and risk-reduction (test stub).",
    selected_task_id: null,
    modelId: "test-stub",
  }))
})

afterEach(() => {
  __clearGeminiPolishStub()
  __clearGoalStepsStub()
})

test("parseGenerateBody rejects empty tasks", () => {
  assert.throws(
    () => parseGenerateBody({ tasks: "", time: "60" }),
    ValidationError,
  )
})

test("parseGenerateBody merges short-term and long-term goals", () => {
  const p = parseGenerateBody({
    tasks: "One task est:30",
    time: 60,
    shortTermGoals: "Finish homework",
    longTermGoals: "Internship and GPA",
  })
  assert.match(p.goalsRaw, /Short-term:/)
  assert.match(p.goalsRaw, /Long-term:/)
  assert.equal(p.memoryRecent.length, 0)
})

test("parseGenerateBody sanitizes memory.recentRuns", () => {
  const p = parseGenerateBody({
    tasks: "Task est:10",
    time: 5,
    memory: {
      recentRuns: [
        { at: "2026-01-01", action: "Start: A", topTitle: "A", orbitScoreTop: 0.5 },
        { bad: true },
        null,
      ],
    },
  })
  assert.equal(p.memoryRecent.length, 1)
  assert.equal(p.memoryRecent[0].topTitle, "A")
  assert.equal(p.behaviorOutcomes.length, 0)
})

test("parseGenerateBody parses behavior outcomes", () => {
  const p = parseGenerateBody({
    tasks: "T est:5",
    time: 10,
    behavior: {
      outcomes: [{ topTitle: "X", outcome: "ignored", at: "2026-01-02" }],
    },
  })
  assert.equal(p.behaviorOutcomes.length, 1)
  assert.equal(p.behaviorOutcomes[0].outcome, "ignored")
})

test("parseGenerateBody accepts hours instead of time", () => {
  const p = parseGenerateBody({
    tasks: "A est:10",
    hours: 2,
  })
  assert.equal(p.timeAvailableMinutes, 120)
})

test("taskStringsFromRaw splits comma-separated chores on one line", () => {
  assert.deepEqual(taskStringsFromRaw("CS 178 homework, washing dishes"), [
    "CS 178 homework",
    "washing dishes",
  ])
})

test("taskStringsFromRaw keeps line with est/due as one task", () => {
  const t = taskStringsFromRaw("Part A, Part B est:45 due:2026-04-22")
  assert.equal(t.length, 1)
})

test("parseTimeMinutes accepts hours and combined h/m", () => {
  assert.equal(parseTimeMinutes("2 hours"), 120)
  assert.equal(parseTimeMinutes("90 min"), 90)
  assert.equal(parseTimeMinutes("1h 30m"), 90)
  assert.equal(parseTimeMinutes("1h30m"), 90)
  assert.equal(parseTimeMinutes("45"), 45)
})

test("generateNextAction scores comma-separated tasks separately", async () => {
  const out = await generateNextAction({
    tasks: "CS 178 homework, washing dishes",
    time: "2 hours",
    mood: "2",
    shortTermGoals: "getting A+",
    longTermGoals: "internship and GPA",
  })
  assert.equal(out.orbit.ranked.length, 2)
  const titles = out.orbit.ranked.map((r) => r.title.toLowerCase())
  assert.ok(titles.some((t) => t.includes("178") || t.includes("homework")))
  assert.ok(titles.some((t) => t.includes("wash")))
})

test("parseGenerateBody allows long-term up to 560 chars", () => {
  const long = "x".repeat(400)
  const p = parseGenerateBody({
    tasks: "A est:10",
    time: 30,
    shortTermGoals: "short",
    longTermGoals: long,
  })
  assert.equal(p.goalsLong.length, 400)
})

test("parseGenerateBody rejects multiline goals", () => {
  assert.throws(
    () =>
      parseGenerateBody({
        tasks: "A est:1",
        time: 30,
        shortTermGoals: "line1\nline2",
      }),
    ValidationError,
  )
})

test("duration hints override keyword default", () => {
  const tasks = [
    {
      id: "t0",
      title: "reading book",
      dueAt: null,
      estimatedMinutes: 60,
      estProvided: false,
      dependsOn: null,
    },
  ]
  const hints = sanitizeDurationHints({
    overrides: [{ pattern: "reading", minutes: 33 }],
  })
  const { tasks: out } = applyDurationPredictions(tasks, hints)
  assert.equal(out[0].estimatedMinutes, 33)
})

test("formatSentinelRiskLine includes before/after index and memory", () => {
  const line = formatSentinelRiskLine(
    {
      deferHours: 24,
      deferHoursLong: 72,
      meanUrgencyNow: 0.41,
      meanUrgencyIfDeferChosen: 0.48,
      meanUrgencyDelta: 0.07,
      meanUrgencyIfDefer72h: 0.5,
      meanUrgencyDelta72h: 0.09,
      workloadRatio: 1.2,
      allUndated: false,
      deadlineCollisionCount: 0,
      stressEscalationIndex: 0.35,
      riskLevel: "MEDIUM",
      riskProbabilityScore: 55,
    },
    [{ topTitle: "CS178" }],
  )
  assert.match(line, /41%/)
  assert.match(line, /48%/)
  assert.match(line, /Structured risk/)
  assert.match(line, /Session memory/)
})

test("formatSentinelRiskLine adds undated tip when allUndated", () => {
  const line = formatSentinelRiskLine({
    deferHours: 24,
    deferHoursLong: 72,
    meanUrgencyNow: 0.32,
    meanUrgencyIfDeferChosen: 0.32,
    meanUrgencyDelta: 0,
    meanUrgencyIfDefer72h: 0.32,
    meanUrgencyDelta72h: 0,
    workloadRatio: 0.67,
    allUndated: true,
    deadlineCollisionCount: 0,
    stressEscalationIndex: 0.1,
    riskLevel: "LOW",
    riskProbabilityScore: 30,
  })
  assert.match(line, /32%/)
  assert.match(line, /Tip: No due:/)
})

test("parseTaskLine extracts due and est", () => {
  const t = parseTaskLine("CS178 PSet est:90 due:2026-04-20", 0)
  assert.equal(t.estimatedMinutes, 90)
  assert.equal(t.estProvided, true)
  assert.ok(t.dueAt?.startsWith("2026-04-20"))
  assert.match(t.title, /CS178 PSet/)
})

test("parseTaskLine marks implicit duration", () => {
  const t = parseTaskLine("fill water bottle", 0)
  assert.equal(t.estProvided, false)
  assert.equal(t.estimatedMinutes, 60)
})

test("parseTaskLine parses after dependency hint", () => {
  const t = parseTaskLine("Write report after:task_0 est:20", 1)
  assert.equal(t.dependsOn, "task_0")
  assert.equal(t.estimatedMinutes, 20)
  assert.match(t.title, /Write report/i)
})

test("ORBIT_WEIGHTS sum to 1", () => {
  const s =
    ORBIT_WEIGHTS.urgency +
    ORBIT_WEIGHTS.goalAlignment +
    ORBIT_WEIGHTS.feasibility +
    ORBIT_WEIGHTS.riskReduction
  assert.ok(Math.abs(s - 1) < 1e-9)
})

test("sanitizeBehaviorOutcomes filters invalid", () => {
  const o = sanitizeBehaviorOutcomes({
    outcomes: [{ topTitle: "A", outcome: "done", at: "2026-01-01" }, { bad: true }],
  })
  assert.equal(o.length, 1)
  assert.equal(o[0].outcome, "done")
})

test("buildBehaviorProfileSnapshot computes rates", () => {
  const snap = buildBehaviorProfileSnapshot(
    [{ topTitle: "X", orbitScoreTop: 0.4 }],
    [
      { topTitle: "X", outcome: "done", at: "1" },
      { topTitle: "Y", outcome: "ignored", at: "2" },
    ],
  )
  assert.equal(snap.completion_rate, 0.5)
  assert.ok(snap.procrastination_tendency_proxy > 0)
  assert.equal(snap.completion_rate_0_100, 50)
  assert.ok(typeof snap.focus_duration_pattern_score_0_100 === "number")
})

test("partitionScheduleRows keeps top task always", () => {
  const mk = (id, title, score) => ({
    task: {
      id,
      title,
      dueAt: null,
      estimatedMinutes: 10,
      estProvided: true,
      dependsOn: null,
    },
    orbitScore: score,
    urgency: 0.5,
    goalAlignment: 0.5,
    feasibility: 0.5,
    riskReduction: 0.5,
  })
  const rows = [mk("t0", "High", 0.92), mk("t1", "Low", 0.08)]
  const { eligible, discarded } = partitionScheduleRows(rows)
  assert.equal(eligible.length, 1)
  assert.equal(eligible[0].task.id, "t0")
  assert.equal(discarded.length, 1)
})

test("parseScheduleBody clamps days and minutesPerDay", () => {
  const p = parseScheduleBody({
    tasks: "A\nB",
    time: 120,
    scheduleDays: 99,
    minutesPerDay: 2000,
  })
  assert.equal(p.scheduleDays, 14)
  assert.equal(p.minutesPerDay, 24 * 60)
})

test("duration agent predicts water task", () => {
  const tasks = [
    { id: "t0", title: "fill water bottle", dueAt: null, estimatedMinutes: 60, estProvided: false },
  ]
  const { tasks: out } = applyDurationPredictions(tasks)
  assert.equal(out[0].estimatedMinutes, 5)
})

test("scheduler packs by rank", () => {
  const ranked = [
    { task: { id: "a", title: "A", estimatedMinutes: 40, dueAt: null, estProvided: true }, orbitScore: 0.9 },
    { task: { id: "b", title: "B", estimatedMinutes: 30, dueAt: null, estProvided: true }, orbitScore: 0.5 },
  ]
  const s = buildScheduleFromRanked(ranked, {
    scheduleDays: 1,
    capacityPerDayMinutes: 70,
    horizonStartMs: Date.parse("2026-04-18T12:00:00.000Z"),
  })
  assert.equal(s.days[0].blocks.length, 2)
  assert.equal(s.overflow.length, 0)
})

test("generateSchedule returns agents and schedule", async () => {
  const out = await generateSchedule({
    tasks: ["reading est:30", "apply to jobs", "fill bottle"].join("\n"),
    time: 90,
    scheduleDays: 2,
    shortTermGoals: "stay hydrated",
    mood: "4",
  })
  assert.equal(out.mode, "multi_agent_schedule")
  assert.ok(Array.isArray(out.agents))
  assert.ok(out.userModel?.archetype)
  assert.ok(out.schedule?.days?.length >= 1)
})

test("planLongTermGoalSteps returns steps from stub", async () => {
  __setGoalStepsStub(async () => ({
    steps: [
      { title: "Clarify outcome metrics", dayOffset: 0 },
      { title: "Draft milestone one", dayOffset: 1 },
      { title: "Ship prototype", dayOffset: 3 },
      { title: "Gather feedback", dayOffset: 5 },
    ],
  }))
  const out = await planLongTermGoalSteps({ goal: "Become a staff engineer", shortTermContext: "study" })
  assert.equal(out.steps.length, 4)
  assert.equal(out.modelId, "test-stub")
})

test("handlePlanLongTermSteps validates goal", async () => {
  await assert.rejects(() => handlePlanLongTermSteps({ goal: "" }), ValidationError)
})

test("generateNextAction ranks nearer deadline higher (fixed asOf)", async () => {
  const body = {
    asOf: "2026-04-18T12:00:00.000Z",
    tasks: [
      "Exam prep est:120 due:2026-04-27",
      "CS178 homework est:90 due:2026-04-20",
      "Internship apps est:75",
    ].join("\n"),
    goals: "internship GPA classes CS178",
    time: 120,
    mood: "low",
  }

  const out = await generateNextAction(body)
  assert.match(out.action, /CS178/)
  assert.equal(out.orbit.ranked[0].id, "task_1")
  assert.equal(out.orbit.ranked[0].title.toLowerCase().includes("cs178"), true)
  assert.ok(typeof out.sentinel.workloadRatio === "number")
  assert.ok(out.confidence >= 52 && out.confidence <= 97)
})
