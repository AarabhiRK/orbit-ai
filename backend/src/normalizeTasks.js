const MAX_TASK_INPUTS = 50
const MAX_TASK_PART_LEN = 180
const MIN_TASK_PART_LEN = 2

/**
 * Split the tasks textarea into individual task strings.
 * - Primary: one task per line.
 * - If a line has no `est:` / `due:` hints, comma- or semicolon-separated
 *   phrases become separate tasks (e.g. "CS178 homework, wash dishes").
 * - Lines with `est:` or `due:` stay a single task so metadata applies once.
 *
 * @param {string} tasksRaw
 * @returns {string[]}
 */
export function taskStringsFromRaw(tasksRaw) {
  const rawLines = String(tasksRaw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const out = []
  for (const line of rawLines) {
    if (out.length >= MAX_TASK_INPUTS) break

    if (/\b(?:est|due):/i.test(line)) {
      out.push(line)
      continue
    }

    const parts = line
      .split(/[,;]\s*/)
      .map((p) => p.trim())
      .filter(
        (p) =>
          p.length >= MIN_TASK_PART_LEN && p.length <= MAX_TASK_PART_LEN,
      )

    if (parts.length >= 2) {
      for (const p of parts) {
        if (out.length >= MAX_TASK_INPUTS) break
        out.push(p)
      }
    } else {
      out.push(line)
    }
  }

  return out
}

/**
 * One task per line. Optional hints (stripped from title):
 *   due:2026-04-20  or  due:2026-04-20T23:59:00Z
 *   est:90   or   90min
 */
export function parseTaskLine(raw, index) {
  let line = String(raw).trim()
  let dueAt = null
  let estimatedMinutes = 60

  const dueMatch = line.match(/\bdue:\s*([^\s|]+)/i)
  if (dueMatch) {
    const ms = Date.parse(dueMatch[1])
    if (!Number.isNaN(ms)) dueAt = new Date(ms).toISOString()
    line = line.replace(dueMatch[0], " ").trim()
  }

  const estColon = line.match(/\best:\s*(\d+)/i)
  const estMinWord = line.match(/\b(\d+)\s*min(?:utes)?\b/i)
  const estMatch = estColon ?? estMinWord
  if (estMatch) {
    estimatedMinutes = Math.max(1, Number.parseInt(estMatch[1], 10))
    line = line.replace(estMatch[0], " ").trim()
  }

  line = line
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,|]+|[,|]+$/g, "")
    .trim()

  const title = line || `Task ${index + 1}`

  return {
    id: `task_${index}`,
    title,
    dueAt,
    estimatedMinutes,
  }
}

export function normalizeTasksFromLines(lines) {
  return lines.map((line, i) => parseTaskLine(line, i))
}
