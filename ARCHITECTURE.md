# ORBIT architecture (MVP)

## Primary path: multi-agent schedule (product UI)

```
Browser (React)
  → POST /generate-schedule {
        tasks, mood, time,                    // time = minutes/day capacity (baseline)
        optional minutesPerDay, scheduleDays (1–14, default 7),
        shortTermGoals, longTermGoals, memory.recentRuns, optional goals, asOf
      }
      → parseScheduleBody (+ sanitize memory)
      → normalize tasks (estProvided when user gave est:/Nmin)
      → Agent: user_profile — deterministic tags + summary from tasks/goals/mood/memory
      → Agent: duration — predict minutes when est not on line (keyword rules + default)
      → ORBIT Core: score ranked list using predicted minutes + minutesPerDay feasibility
      → Agent: scheduler — greedy pack highest score first into day buckets
        (capacity per day = minutesPerDay × energy factor)
      → Sentinel on first scheduled block (risk line + session memory)
      → optional Gemini: polish reason + future_impact only (risk unchanged)
  → JSON: userModel, agents[], schedule{days,overflow,totals}, tasksResolved, orbit, sentinel, debug
```

## Legacy: single next action

`POST /generate-next-action` still runs **parseGenerateBody → normalize → score → Sentinel → optional Gemini** (no multi-day packer). Use for minimal demos or API clients.

## End-to-end path (legacy single action)

```
Browser or script
  → POST /generate-next-action { tasks, mood, time, goals fields, memory, asOf }
      → parse + validate → normalize → ORBIT Core → Sentinel → build one action
      → optional Gemini: reason + future_impact only
  → JSON (+ orbit, sentinel, debug)
```

## ORBIT score (policy)

Weights on 0–1 subscores: **0.35 urgency + 0.30 goal alignment + 0.20 feasibility + 0.15 risk-reduction** (`ORBIT_WEIGHTS` in `constants.js`). Each ranked row also exposes `*_0_100` for judges.

## Behavior memory (client)

- Optional `behavior: { outcomes: [{ at, topTitle, outcome: "done"|"ignored" }] }` — sanitized like session runs.
- `userModel.behavior_profile` holds proxies: completion rate, procrastination proxy, ignored count (no DB).

## Auditability (for judges)

| Field | Meaning |
|--------|--------|
| `orbit.ranked[]` | Per-task scores and final `orbitScore` (transparent math). |
| `userModel` / `agents[]` | Schedule mode only: who-we-think-you-are + per-agent outputs for audit. |
| `schedule.days[]` | Packed blocks with `startMinuteInDay` / `endMinuteInDay` (offset in the protected work window). |
| `tasksResolved[]` | Per-task scores plus `estProvided` after duration prediction. |
| `confidence` | Higher when **#1 vs #2** score gap is large (not self-reported fluff). |
| `sentinel.*` | Deferral / workload metrics from rules, not prose. |
| `debug.narrative_source` | `gemini` vs `orbit-core` (whether LLM polished **reason** / **future_impact** / optional **tradeoffs**; **risk** is always core). |
| `candidates_top_3` / `alternatives` | Top three ranked rows and #2–#3 summaries. |
| `confidence_breakdown` | Data quality, decision stability, risk-uncertainty subscores + composite `confidence`. |
| `sentinel.riskLevel` | `LOW` / `MEDIUM` / `HIGH` from rule-based points + `riskProbabilityScore`. |
| `schedule.discarded_from_packing` | Tasks below dynamic floor vs #1 score, excluded from packing only. |
| `debug.llm` | When a key is set: success/failure of polish step. |

## Goals (short + long)

- **`shortTermGoals`** and **`longTermGoals`** are merged into one `goalsRaw` string for token overlap (`Short-term: …` / `Long-term: …`).
- Optional legacy **`goals`** is appended as `Context: …` when the split fields are present.

## Session memory (no database)

- Browser stores the last **8** successful runs under `localStorage` key `orbit_v1_session_memory`.
- Each run: `{ at, action, topTitle, orbitScoreTop }`.
- Client sends `memory: { recentRuns }` on every request; server **sanitizes** and uses it in **Risk** (recent picks line) and in the **Gemini** brief when enabled.

## Task line format (parser)

One task per line. Optional fragments anywhere on the line:

- `est:90` or `90min` — estimated minutes (default 60 placeholder; **duration agent** may replace when `estProvided` is false).
- `due:2026-04-22` or ISO datetime — deadline for urgency.

## Failure modes (operational)

| Situation | HTTP | Response |
|-----------|------|----------|
| No tasks / blank lines | **400** | `{ "error": "…" }` |
| Missing or invalid `time` | **400** | `{ "error": "…" }` |
| Unexpected server error | **500** | `{ "error": "…", "system": "failure" }` |
| Gemini quota / timeout / bad JSON | **200** | Same payload; **deterministic** `reason` and `future_impact` (and `risk` is always Sentinel); `debug.llm.ok: false` |

## Health

- `GET /` — plain text liveness.
- `GET /health` — JSON; includes `gemini_configured` (boolean, no secret leaked).

## Env (backend)

See `backend/.env.example`. Secrets only in `backend/.env` (gitignored).
