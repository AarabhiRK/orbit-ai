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
