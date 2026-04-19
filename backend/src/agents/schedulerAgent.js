/**
 * Greedy multi-day packer: higher ORBIT score first, fixed per-day capacity.
 */

/**
 * @param {Array<{ task: object, orbitScore: number }>} rankedRows — best task first
 * @param {{ scheduleDays: number, capacityPerDayMinutes: number, horizonStartMs: number }} opts
 */
export function buildScheduleFromRanked(rankedRows, opts) {
  const scheduleDays = Math.max(1, opts.scheduleDays)
  const capacityPerDayMinutes = Math.max(1, opts.capacityPerDayMinutes)
  const startMs = opts.horizonStartMs ?? Date.now()

  const days = []
  for (let d = 0; d < scheduleDays; d++) {
    const date = new Date(startMs + d * 86_400_000).toISOString().slice(0, 10)
    days.push({
      dayIndex: d,
      date,
      capacityMinutes: capacityPerDayMinutes,
      usedMinutes: 0,
      blocks: [],
    })
  }

  const backlog = rankedRows.map((r) => ({
    task: r.task,
    orbitScore: r.orbitScore,
    left: Math.max(1, Math.round(Number(r.task.estimatedMinutes) || 1)),
  }))

  let d = 0
  for (const work of backlog) {
    while (work.left > 0 && d < scheduleDays) {
      const day = days[d]
      const room = day.capacityMinutes - day.usedMinutes
      if (room <= 0) {
        d++
        continue
      }
      const take = Math.min(work.left, room)
      const last = day.blocks[day.blocks.length - 1]
      const continuesSame =
        last &&
        last.taskId === work.task.id &&
        last.endMinuteInDay === day.usedMinutes
      if (continuesSame) {
        last.endMinuteInDay += take
        last.minutes += take
      } else {
        day.blocks.push({
          startMinuteInDay: day.usedMinutes,
          endMinuteInDay: day.usedMinutes + take,
          taskId: work.task.id,
          title: work.task.title,
          minutes: take,
        })
      }
      day.usedMinutes += take
      work.left -= take
      if (day.usedMinutes >= day.capacityMinutes) d++
    }
  }

  const overflow = backlog
    .filter((w) => w.left > 0)
    .map((w) => ({
      taskId: w.task.id,
      title: w.task.title,
      unscheduledMinutes: w.left,
      orbitScore: w.orbitScore,
    }))

  const totalDemandMinutes = rankedRows.reduce(
    (s, r) => s + Math.max(1, Math.round(Number(r.task.estimatedMinutes) || 1)),
    0,
  )
  const totalCapacityMinutes = scheduleDays * capacityPerDayMinutes
  const plannedMinutes = totalDemandMinutes - overflow.reduce((s, o) => s + o.unscheduledMinutes, 0)

  return {
    days,
    overflow,
    totals: {
      totalDemandMinutes,
      totalCapacityMinutes,
      plannedMinutes,
      unscheduledMinutes: overflow.reduce((s, o) => s + o.unscheduledMinutes, 0),
    },
  }
}
