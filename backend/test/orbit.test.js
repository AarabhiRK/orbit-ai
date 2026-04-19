import test from "node:test"
import assert from "node:assert/strict"
import { generateNextAction } from "../src/generateNextAction.js"
import { parseTaskLine } from "../src/normalizeTasks.js"
import { ValidationError, parseGenerateBody } from "../src/parseBody.js"
import { formatSentinelRiskLine } from "../src/sentinel.js"

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
})

test("formatSentinelRiskLine includes before/after index and memory", () => {
  const line = formatSentinelRiskLine(
    {
      deferHours: 24,
      meanUrgencyNow: 0.41,
      meanUrgencyIfDeferChosen: 0.48,
      meanUrgencyDelta: 0.07,
      workloadRatio: 1.2,
    },
    [{ topTitle: "CS178" }],
  )
  assert.match(line, /41%/)
  assert.match(line, /48%/)
  assert.match(line, /Session memory/)
})

test("parseTaskLine extracts due and est", () => {
  const t = parseTaskLine("CS178 PSet est:90 due:2026-04-20", 0)
  assert.equal(t.estimatedMinutes, 90)
  assert.ok(t.dueAt?.startsWith("2026-04-20"))
  assert.match(t.title, /CS178 PSet/)
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
