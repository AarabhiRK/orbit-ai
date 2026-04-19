/**
 * Lightweight "who is this?" inference from tasks, goals, mood, and session memory.
 * Deterministic tags — optional LLM can narrate later without changing structure.
 */

/**
 * @param {object} p
 * @param {object[]} p.tasks
 * @param {string} p.goalsRaw
 * @param {unknown} p.mood
 * @param {object[]} p.memoryRecent
 * @param {"low"|"medium"|"high"} p.energy
 * @param {object} [p.behaviorSnapshot] — from buildBehaviorProfileSnapshot
 */
export function inferUserProfile({
  tasks,
  goalsRaw,
  mood,
  memoryRecent,
  energy,
  behaviorSnapshot,
}) {
  const blob = [
    goalsRaw,
    ...tasks.map((t) => t.title),
    String(mood ?? ""),
  ]
    .join(" ")
    .toLowerCase()

  const tags = new Set()
  if (/\b(class|homework|gpa|exam|lecture|professor|university|college|campus)\b/.test(blob)) {
    tags.add("student_academic")
  }
  if (/\b(intern|job|career|apply|resume|linkedin|recruit|network)\b/.test(blob)) {
    tags.add("career_momentum")
  }
  if (/\b(health|gym|run|sleep|water|hydrat|therapy|mental)\b/.test(blob)) {
    tags.add("health_routine")
  }
  if (/\b(read|book|learn|course|tutorial)\b/.test(blob)) {
    tags.add("learning_focus")
  }

  const n = tasks.length
  const load = n >= 8 ? "heavy_backlog" : n >= 4 ? "moderate_backlog" : "light_backlog"

  const archetype =
    tags.has("student_academic") && tags.has("career_momentum")
      ? "student_job_hunter"
      : tags.has("student_academic")
        ? "student"
        : tags.has("career_momentum")
          ? "career_builder"
          : tags.has("health_routine")
            ? "wellbeing_focused"
            : "general_planner"

  const tagList = [...tags]
  const summaryParts = [
    `Archetype: ${archetype.replace(/_/g, " ")}.`,
    tagList.length ? `Signals: ${tagList.join(", ")}.` : "Signals: broad life mix.",
    `Backlog shape: ${load.replace(/_/g, " ")} (${n} tasks).`,
    `Energy band for planning: ${energy}.`,
  ]
  if (memoryRecent.length > 0) {
    summaryParts.push(
      `Session memory: ${memoryRecent.length} recent run(s) — schedule will bias tone, not math.`,
    )
  }
  if (behaviorSnapshot?.outcome_events_recorded > 0) {
    summaryParts.push(
      `Outcomes logged: ${behaviorSnapshot.outcome_events_recorded} (done/ignored taps).`,
    )
  }

  return {
    archetype,
    tags: tagList,
    backlog_load: load,
    energy_band: energy,
    summary: summaryParts.join(" "),
    signals: {
      task_count: n,
      memory_runs_used: memoryRecent.length,
    },
    behavior_profile: behaviorSnapshot ?? null,
  }
}
