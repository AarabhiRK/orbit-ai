/**
 * Gemini model id + fallbacks when the free tier rate-limits one model id.
 * Override with GEMINI_MODEL (single id). Order: env first, then defaults (deduped).
 *
 * Note: gemini-2.0-flash is last in defaults — many free-tier keys hit "limit: 0" on 2.0-flash first.
 */
const DEFAULT_MODEL_CANDIDATES = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash"]

function errorText(err) {
  if (err == null) return ""
  const bits = [
    typeof err.message === "string" ? err.message : "",
    typeof err.statusText === "string" ? err.statusText : "",
    typeof err === "string" ? err : "",
  ]
  if (typeof err.stack === "string") bits.push(err.stack)
  try {
    if (err.errorDetails) bits.push(JSON.stringify(err.errorDetails).slice(0, 2000))
  } catch {
    /* ignore */
  }
  return bits.filter(Boolean).join("\n")
}

export function getGeminiModelCandidates() {
  const primary = process.env.GEMINI_MODEL?.trim()
  const out = []
  // gemini-2.0-flash alone often hits free-tier "limit: 0"; don't put it first when copied from examples.
  if (primary && primary !== "gemini-2.0-flash") out.push(primary)
  for (const id of DEFAULT_MODEL_CANDIDATES) {
    if (id && !out.includes(id)) out.push(id)
  }
  if (primary === "gemini-2.0-flash" && !out.includes("gemini-2.0-flash")) out.push("gemini-2.0-flash")
  return out
}

/** True when another model id might succeed (429 / quota / resource exhausted). */
export function isGeminiRetryableQuotaError(err) {
  const status = typeof err?.status === "number" ? err.status : NaN
  if (status === 429) return true
  const s = errorText(err)
  return (
    /\b429\b/.test(s) ||
    /Too Many Requests/i.test(s) ||
    /RESOURCE_EXHAUSTED/i.test(s) ||
    (/quota/i.test(s) && /exceed/i.test(s))
  )
}

/** Try next model id when this id is not available for the API key. */
export function isGeminiModelUnavailableError(err) {
  const status = typeof err?.status === "number" ? err.status : NaN
  if (status === 404) return true
  const s = errorText(err)
  return /\b404\b/.test(s) && (/not found/i.test(s) || /is not found/i.test(s) || /does not exist/i.test(s))
}
