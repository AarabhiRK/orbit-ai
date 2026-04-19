/**
 * Phase-0 metric contract: names, units, and allowed range.
 * Scoring formulas come later; this file is the single source of truth for "what Y means."
 */
export const METRIC_DEFINITIONS = [
  {
    key: "urgency",
    displayName: "Urgency",
    unit: "dimensionless score in [0, 1]",
    range: "[0, 1]",
    description:
      "How time-critical the action is given deadlines and implied slack.",
  },
  {
    key: "goalAlignment",
    displayName: "Goal alignment",
    unit: "dimensionless score in [0, 1]",
    range: "[0, 1]",
    description:
      "How well the action advances stated short- and long-term goals.",
  },
  {
    key: "feasibility",
    displayName: "Feasibility",
    unit: "dimensionless score in [0, 1]",
    range: "[0, 1]",
    description:
      "How realistic the action is given available time and (optional) energy.",
  },
]
