import { buildBehaviorProfileSnapshot } from "./behaviorMemory.js"
import { parseScheduleBody } from "./parseBody.js"
import { normalizeTasksFromLines, taskStringsFromRaw } from "./normalizeTasks.js"
import { ENERGY_EFFECTIVE_TIME } from "./constants.js"
import { mapRankedRow } from "./orbitPayloadMappers.js"
import {
  confidenceBreakdown,
  partitionScheduleRows,
  scoreTasks,
} from "./scoring.js"
import {
  formatSentinelRiskLine,
  sentinelDeferSnapshot,
  sentinelSnapshotsForTopThree,
} from "./sentinel.js"
import { polishOrbitNarrative } from "./geminiNarrative.js"
import { inferUserProfile } from "./agents/userProfileAgent.js"
import {
  applyDurationPredictions,
  sanitizeDurationHints,
} from "./agents/durationAgent.js"
import { buildScheduleFromRanked } from "./agents/schedulerAgent.js"
import { sortRowsByDependencies } from "./schedulerTopo.js"
import { buildDeterministicTradeoffs } from "./tradeoffsText.js"

function round4(n) {
  return Math.round(n * 10_000) / 10_000
}

function formatClock(minuteInDay) {
  const h = Math.floor(minuteInDay / 60)
  const m = minuteInDay % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/**
 * @param {Record<string, unknown>} body
 */
export async function generateSchedule(body) {
  const parsed = parseScheduleBody(body)
  const lines = taskStringsFromRaw(parsed.tasksRaw)

  let tasks = normalizeTasksFromLines(lines)
  const asOfMs = parsed.asOfIso ? Date.parse(parsed.asOfIso) : Date.now()
  const asOfIso = new Date(asOfMs).toISOString()
  const weights = parsed.orbitWeights

  const behaviorSnapshot = buildBehaviorProfileSnapshot(
    parsed.memoryRecent,
    parsed.behaviorOutcomes,
  )

  const userModel = inferUserProfile({
    tasks,
    goalsRaw: parsed.goalsRaw,
    mood: body.mood,
    memoryRecent: parsed.memoryRecent,
    energy: parsed.energy,
    behaviorSnapshot,
  })

  const durationHints = sanitizeDurationHints(body.durationHints)
  const durationAgent = applyDurationPredictions(tasks, durationHints)
  tasks = durationAgent.tasks

  const rows = scoreTasks(tasks, {
    asOfIso,
    goalsRaw: parsed.goalsRaw,
    timeAvailableMinutes: parsed.timeAvailableMinutes,
    energy: parsed.energy,
    weights,
  })

  const { eligible: eligibleRaw, discarded } = partitionScheduleRows(rows)
  const eligible = sortRowsByDependencies(eligibleRaw)

  const sentinelByCandidate = sentinelSnapshotsForTopThree(
    tasks,
    rows,
    asOfMs,
    parsed.goalsRaw,
    parsed.timeAvailableMinutes,
    parsed.energy,
    weights,
  )

  const factor = ENERGY_EFFECTIVE_TIME[parsed.energy] ?? ENERGY_EFFECTIVE_TIME.medium
  const capacityPerDay = Math.max(15, Math.floor(parsed.minutesPerDay * factor))

  const scheduleCore = buildScheduleFromRanked(eligible, {
    scheduleDays: parsed.scheduleDays,
    capacityPerDayMinutes: capacityPerDay,
    horizonStartMs: asOfMs,
  })

  const firstBlock = scheduleCore.days[0]?.blocks[0]
  const firstTask = firstBlock ? tasks.find((t) => t.id === firstBlock.taskId) : rows[0]?.task

  const sentinel = firstTask
    ? sentinelDeferSnapshot({
        tasks,
        chosenTaskId: firstTask.id,
        asOfMs,
        goalsRaw: parsed.goalsRaw,
        timeAvailableMinutes: parsed.timeAvailableMinutes,
        energy: parsed.energy,
        weights,
      })
    : null

  let risk = sentinel
    ? formatSentinelRiskLine(sentinel, parsed.memoryRecent)
    : "—"
  if (sentinel && sentinelByCandidate.length > 1) {
    const appendix = sentinelByCandidate
      .filter((e) => e.taskId !== firstTask?.id)
      .map(
        (e) =>
          `#${e.rank} ${e.title.slice(0, 48)}: ${e.sentinel.riskLevel} (model ${e.sentinel.riskProbabilityScore}/100; P_collision≈${((e.sentinel.deadlineCollisionProbability ?? 0) * 100).toFixed(0)}%)`,
      )
      .join("\n")
    risk = `${risk}\n\n--- Other top candidates (if not done) ---\n${appendix}`
  }

  const estProvidedRatio =
    tasks.filter((t) => t.estProvided).length / Math.max(1, tasks.length)
  const datedRatio =
    tasks.filter((t) => t.dueAt != null).length / Math.max(1, tasks.length)
  const breakdown = confidenceBreakdown(rows[0], rows[1], {
    estProvidedRatio,
    datedRatio,
    sentinelRiskLevel: sentinel?.riskLevel ?? "MEDIUM",
  })
  const conf = breakdown.composite_percent

  const plannedBlocks = scheduleCore.days.reduce((n, d) => n + d.blocks.length, 0)
  const action = firstBlock
    ? `Start here: ${firstBlock.title} (${firstBlock.minutes} min @ ${formatClock(firstBlock.startMinuteInDay)}) — ${plannedBlocks} block(s) over ${parsed.scheduleDays} day(s).`
    : "No schedulable blocks (check tasks and time)."

  const reason = [
    `User model (${userModel.archetype}): ${userModel.summary}`,
    `Durations: mixed user-supplied, learned hints, and keyword defaults (see agents.duration).`,
    `Ranked by ORBIT weights ${JSON.stringify(weights)}; tail-discarded ${discarded.length} before dependency-aware packing into ~${capacityPerDay} effective min/day (${parsed.energy}, factor ${factor}).`,
  ].join(" ")

  let futureImpact = ""
  if (scheduleCore.overflow.length === 0) {
    futureImpact = `Full backlog fits inside ${parsed.scheduleDays} day(s) at this daily budget (capacity ${scheduleCore.totals.totalCapacityMinutes} min vs demand ${scheduleCore.totals.totalDemandMinutes} min).`
  } else {
    futureImpact = `${scheduleCore.overflow.length} tail item(s) do not fit — add days, raise minutes/day, shorten tasks, or add est: to tighten predictions. Unscheduled: ${scheduleCore.overflow.map((o) => `${o.title} (${o.unscheduledMinutes}m)`).join("; ")}.`
  }

  const steps = []
  if (firstBlock) {
    steps.push(
      `Today block 1 (${formatClock(firstBlock.startMinuteInDay)}–${formatClock(firstBlock.endMinuteInDay)}): ${firstBlock.title}`,
    )
    const second = scheduleCore.days[0]?.blocks[1]
    if (second) {
      steps.push(
        `Then (${formatClock(second.startMinuteInDay)}–${formatClock(second.endMinuteInDay)}): ${second.title}`,
      )
    }
    const day1 = scheduleCore.days[1]
    const cross = day1?.blocks[0]
    if (cross) {
      steps.push(`Day 2 starts with: ${cross.title}`)
    }
    if (steps.length < 3) {
      steps.push("Between blocks: 5-minute reset; stop mid-block only if interrupted.")
    }
  } else {
    steps.push("Add at least one task line and positive time, then regenerate.")
  }

  const tradeoffsDeterministic = buildDeterministicTradeoffs(rows.slice(0, 3))

  const agents = [
    {
      id: "user_profile",
      role: "Understand the user",
      status: "ok",
      output: userModel,
    },
    {
      id: "duration",
      role: "Predict missing task durations",
      status: "ok",
      output: { predictions: durationAgent.byTask, hints_used: durationHints.length },
    },
    {
      id: "orbit_core",
      role: "Score & rank tasks",
      status: "ok",
      output: {
        weights,
        topTitle: rows[0]?.task.title ?? null,
        topScore: rows[0] ? round4(rows[0].orbitScore) : null,
        discarded_pre_pack_count: discarded.length,
      },
    },
    {
      id: "scheduler",
      role: "Pack schedule by day",
      status: scheduleCore.overflow.length ? "partial" : "ok",
      output: {
        scheduleDays: parsed.scheduleDays,
        minutesPerDay: parsed.minutesPerDay,
        effectiveCapacityPerDay: capacityPerDay,
        days: scheduleCore.days,
        overflow: scheduleCore.overflow,
        totals: scheduleCore.totals,
      },
    },
    {
      id: "sentinel",
      role: "Consequence check for top 3 + first scheduled slot",
      status: sentinel ? "ok" : "skipped",
      output: { first_block: sentinel, by_candidate: sentinelByCandidate },
    },
  ]

  const payload = {
    mode: "multi_agent_schedule",
    action,
    steps,
    reason,
    risk,
    future_impact: futureImpact,
    confidence: conf,
    confidence_margin_percent: breakdown.headline_margin_percent,
    confidence_breakdown: {
      data_confidence: breakdown.data_confidence,
      decision_stability: breakdown.decision_stability,
      risk_uncertainty: breakdown.risk_uncertainty,
      note: "Composite blends data quality, rank stability, and Sentinel risk band.",
    },
    userModel,
    candidates_top_3: rows.slice(0, 3).map(mapRankedRow),
    alternatives: rows.slice(1, 3).map((r) => ({
      id: r.task.id,
      title: r.task.title,
      orbitScore: round4(r.orbitScore),
      one_line: `Score ${round4(r.orbitScore)} — ${r.task.title.slice(0, 60)}`,
    })),
    sentinel_by_candidate: sentinelByCandidate.map((e) => ({
      rank: e.rank,
      taskId: e.taskId,
      title: e.title,
      orbitScore: round4(e.orbitScore),
      sentinel: {
        riskLevel: e.sentinel.riskLevel,
        riskProbabilityScore: e.sentinel.riskProbabilityScore,
        workloadRatio: round4(e.sentinel.workloadRatio),
        deadlineCollisionProbability: e.sentinel.deadlineCollisionProbability,
        opportunityCostImpact0_100: e.sentinel.opportunityCostImpact0_100,
        stressEscalationIndex: round4(e.sentinel.stressEscalationIndex),
      },
    })),
    tradeoffs: tradeoffsDeterministic,
    llm_selected_task_id: null,
    tasksResolved: rows.map(mapRankedRow),
    schedule: {
      days: scheduleCore.days,
      overflow: scheduleCore.overflow,
      totals: scheduleCore.totals,
      discarded_from_packing: discarded,
    },
    agents,
    orbit: {
      asOf: asOfIso,
      weights: { ...weights },
      ranked: rows.map(mapRankedRow),
    },
    sentinel: sentinel
      ? {
          deferHours: sentinel.deferHours,
          deferHoursLong: sentinel.deferHoursLong,
          meanUrgencyNow: round4(sentinel.meanUrgencyNow),
          meanUrgencyIfDeferChosen: round4(sentinel.meanUrgencyIfDeferChosen),
          meanUrgencyDelta: round4(sentinel.meanUrgencyDelta),
          meanUrgencyIfDefer72h: round4(sentinel.meanUrgencyIfDefer72h),
          meanUrgencyDelta72h: round4(sentinel.meanUrgencyDelta72h),
          workloadRatio: round4(sentinel.workloadRatio),
          allUndated: sentinel.allUndated,
          scoreGapTop2: round4(sentinel.scoreGapTop2),
          riskLevel: sentinel.riskLevel,
          riskProbabilityScore: sentinel.riskProbabilityScore,
          deadlineCollisionCount: sentinel.deadlineCollisionCount,
          deadlineCollisionProbability: sentinel.deadlineCollisionProbability,
          tasksDueIn72h: sentinel.tasksDueIn72h,
          stressEscalationIndex: round4(sentinel.stressEscalationIndex),
          opportunityCostTop2Gap: round4(sentinel.opportunityCostTop2Gap),
          opportunityCostImpact0_100: sentinel.opportunityCostImpact0_100,
        }
      : null,
    debug: {
      received: {
        tasks: body.tasks,
        mood: body.mood,
        time: body.time,
        hours: body.hours ?? body.hoursAvailable,
        minutesPerDay: body.minutesPerDay,
        hoursPerDay: body.hoursPerDay,
        scheduleDays: body.scheduleDays,
        goals: body.goals,
        shortTermGoals: body.shortTermGoals,
        longTermGoals: body.longTermGoals,
        memory: { recentRuns: parsed.memoryRecent },
        behavior: { outcomes: parsed.behaviorOutcomes },
        policy: body.policy ?? null,
        durationHints: body.durationHints ?? null,
        asOf: body.asOf,
      },
      system: "orbit-schedule",
    },
  }

  const polished = await polishOrbitNarrative(payload)
  const usedGemini = polished.modelId !== "deterministic-fallback"
  payload.debug = {
    ...payload.debug,
    narrative_source: usedGemini ? "gemini" : "deterministic_fallback",
    llm: usedGemini
      ? { provider: "gemini", model: polished.modelId, ok: true }
      : {
          provider: "gemini",
          model: polished.modelId,
          ok: false,
          error: polished._llmNotes ?? "narrative_unavailable",
        },
  }
  payload.reason = polished.reason
  payload.future_impact = polished.future_impact
  payload.tradeoffs =
    polished.tradeoffs && polished.tradeoffs.trim().length >= 20
      ? polished.tradeoffs
      : tradeoffsDeterministic
  if (polished.selected_task_id) {
    const allowed = new Set(rows.slice(0, 3).map((r) => r.task.id))
    if (allowed.has(polished.selected_task_id)) {
      payload.llm_selected_task_id = polished.selected_task_id
    }
  }

  return payload
}
