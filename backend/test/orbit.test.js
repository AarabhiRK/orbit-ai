import test from "node:test"
import assert from "node:assert/strict"
import { generateNextAction } from "../src/generateNextAction.js"
import { parseTaskLine } from "../src/normalizeTasks.js"
import { ValidationError, parseGenerateBody } from "../src/parseBody.js"

test("parseGenerateBody rejects empty tasks", () => {
  assert.throws(
    () => parseGenerateBody({ tasks: "", time: "60" }),
    ValidationError,
  )
})

test("parseTaskLine extracts due and est", () => {
  const t = parseTaskLine("CS178 PSet est:90 due:2026-04-20", 0)
  assert.equal(t.estimatedMinutes, 90)
  assert.ok(t.dueAt?.startsWith("2026-04-20"))
  assert.match(t.title, /CS178 PSet/)
})

test("generateNextAction ranks nearer deadline higher (fixed asOf)", () => {
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

  const out = generateNextAction(body)
  assert.match(out.action, /CS178/)
  assert.equal(out.orbit.ranked[0].id, "task_1")
  assert.equal(out.orbit.ranked[0].title.toLowerCase().includes("cs178"), true)
  assert.ok(typeof out.sentinel.workloadRatio === "number")
  assert.ok(out.confidence >= 52 && out.confidence <= 97)
})
