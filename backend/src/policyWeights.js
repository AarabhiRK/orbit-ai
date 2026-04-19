import { ORBIT_WEIGHTS } from "./constants.js"

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x))
}

/**
 * Client or server nudges to ORBIT weights. Each delta clamped; result renormalized to sum 1.
 *
 * @param {Record<string, number>} [deltas]
 * @returns {typeof ORBIT_WEIGHTS}
 */
export function mergeOrbitWeightDeltas(deltas) {
  const keys = ["urgency", "goalAlignment", "feasibility", "riskReduction"]
  const out = {}
  let s = 0
  for (const k of keys) {
    const base = ORBIT_WEIGHTS[k]
    const d = deltas && typeof deltas[k] === "number" ? deltas[k] : 0
    out[k] = clamp(base + d, 0.06, 0.55)
    s += out[k]
  }
  for (const k of keys) out[k] = out[k] / s
  return out
}

/**
 * @param {unknown} raw — body.policy?.orbitWeightDeltas
 */
export function sanitizeOrbitWeightDeltas(raw) {
  if (!raw || typeof raw !== "object") return {}
  const keys = ["urgency", "goalAlignment", "feasibility", "riskReduction"]
  const out = {}
  for (const k of keys) {
    const v = raw[k]
    const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""))
    if (Number.isFinite(n) && Math.abs(n) < 0.2) out[k] = n
  }
  return out
}

/**
 * Auto nudge from outcome history (browser-only data; transparent).
 *
 * @param {{ outcome: string }[]} outcomes
 */
export function weightDeltasFromBehaviorOutcomes(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length < 4) return {}
  const recent = outcomes.slice(0, 12)
  const ignored = recent.filter((o) => o.outcome === "ignored").length
  const rate = ignored / recent.length
  if (rate >= 0.45) {
    return {
      urgency: 0.03,
      goalAlignment: 0.02,
      feasibility: -0.02,
      riskReduction: 0.01,
    }
  }
  if (rate <= 0.15) {
    return {
      urgency: -0.01,
      goalAlignment: 0.01,
      feasibility: 0.01,
      riskReduction: -0.01,
    }
  }
  return {}
}
