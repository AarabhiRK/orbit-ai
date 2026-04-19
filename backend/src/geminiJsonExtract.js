/**
 * Shared helpers for parsing JSON objects from Gemini text (often wrapped in markdown or preamble).
 */

function tryParseJson(s) {
  try {
    const v = JSON.parse(s)
    return typeof v === "object" && v !== null ? v : null
  } catch {
    return null
  }
}

/**
 * Parse model output: fenced ```json``` block, full string, or first `{` … last `}` slice.
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
export function extractJsonObject(text) {
  const trimmed = String(text).trim()
  if (!trimmed) return null
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = []
  if (fence) candidates.push(fence[1].trim())
  candidates.push(trimmed)
  for (const raw of candidates) {
    const j = tryParseJson(raw)
    if (j) return j
  }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    const j = tryParseJson(trimmed.slice(start, end + 1))
    if (j) return j
  }
  return null
}
