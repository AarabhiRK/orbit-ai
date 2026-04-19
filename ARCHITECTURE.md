# ORBIT architecture (MVP)

## End-to-end path

```
Browser (React)
  → POST /generate-next-action {
        tasks, mood, time,
        shortTermGoals, longTermGoals,   // combined into goalsRaw for alignment
        memory: { recentRuns },          // optional; from localStorage (last 8 runs)
        optional legacy "goals", asOf
      }
      → parse + validate body (+ sanitize memory.recentRuns)
      → normalize task lines (optional est: / due: hints)
      → ORBIT Core: urgency, goal-alignment, feasibility → weighted score → rank
      → Sentinel: defer-one-day index (% now → % if defer) + workload ratio + memory line
      → build action, steps, reason, risk, future_impact, confidence
      → optional Gemini: rewrite reason / risk / future_impact (uses session_memory in brief)
  → JSON response (+ orbit, sentinel, debug)
```

## Auditability (for judges)

| Field | Meaning |
|--------|--------|
| `orbit.ranked[]` | Per-task scores and final `orbitScore` (transparent math). |
| `confidence` | Higher when **#1 vs #2** score gap is large (not self-reported fluff). |
| `sentinel.*` | Deferral / workload metrics from rules, not prose. |
| `debug.narrative_source` | `gemini` vs `orbit-core` (whether LLM narrative applied). |
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

- `est:90` or `90min` — estimated minutes (default 60).
- `due:2026-04-22` or ISO datetime — deadline for urgency.

## Failure modes (operational)

| Situation | HTTP | Response |
|-----------|------|----------|
| No tasks / blank lines | **400** | `{ "error": "…" }` |
| Missing or invalid `time` | **400** | `{ "error": "…" }` |
| Unexpected server error | **500** | `{ "error": "…", "system": "failure" }` |
| Gemini quota / timeout / bad JSON | **200** | Same payload; **deterministic** `reason` / `risk` / `future_impact`; `debug.llm.ok: false` |

## Health

- `GET /` — plain text liveness.
- `GET /health` — JSON; includes `gemini_configured` (boolean, no secret leaked).

## Env (backend)

See `backend/.env.example`. Secrets only in `backend/.env` (gitignored).
