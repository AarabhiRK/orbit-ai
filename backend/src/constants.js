/** Policy: urgency + goal fit + feasibility + risk-reduction (all 0–1 inputs). */
export const ORBIT_WEIGHTS = {
  urgency: 0.35,
  goalAlignment: 0.3,
  feasibility: 0.2,
  riskReduction: 0.15,
}

export const SLACK_NORMALIZATION_MINUTES = 10_080 // 7 days
export const NO_DEADLINE_URGENCY = 0.32

export const ENERGY_EFFECTIVE_TIME = {
  high: 1,
  medium: 0.95,
  low: 0.82,
}

export const DEFER_HOURS = 24 // Sentinel: primary defer window (hours)
export const DEFER_HOURS_LONG = 72 // Secondary horizon for stress / index comparison
