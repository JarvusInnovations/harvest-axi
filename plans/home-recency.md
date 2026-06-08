---
status: done
depends: [ambient]
specs:
  - specs/commands/home.md
issues: []
---

# Plan: Home recency — active timer, last entry, recent 3

## Scope

Enrich the configured home view (post-`ambient`) with recency signals a time-tracker needs at a glance: an **active-timer** line, the **last entry** date with a relative label, and the **last 3 entries** — alongside the existing today summary. **In:** rework `home.ts`'s live block to derive all of this from a single recent-entries call. **Out:** no new command; no change to the unconfigured view or the hook.

## Implements

- `specs/commands/home.md` — the new configured-output shape and its rules (active_timer omitted when none, today "nothing logged yet", last_entry relative label, recent ≤3), all from one `time_entries?user_id=me&per_page=50` call, still ≤1 API call.

## Approach

1. Replace the today-only fetch with `time_entries?user_id=<self>&per_page=50` (newest-first).
2. Derive from the response: the running entry (`active_timer`), today's hours/count (`today`), the newest entry's date + relative label (`last_entry`), and the first 3 rows (`recent`).
3. Render with the existing output helpers; omit each field per the spec's rules; keep the try/catch graceful-degradation.
4. Add `home.test.ts` covering: active timer present/absent, today summary, last-entry relative label, recent table, and the no-entries-at-all case.

## Validation

- [x] Home shows `active_timer` only when a timer runs; omitted otherwise. _(live: self-cleaning running entry showed it; absent otherwise; unit-tested both)_
- [x] `today` reflects today's summed hours/count, or "nothing logged yet". _(live: "nothing logged yet" then "0h across 1 entry"; unit: "2.5h across 2 entries")_
- [x] `last_entry` shows the newest entry's date with today/yesterday/N-days-ago. _(live: "2026-06-05 (3 days ago)", "(today)")_
- [x] `recent` lists up to 3 newest entries; omitted when none. _(live + unit)_
- [x] Still one API call; failure drops the live block and keeps identity + suggestions. _(unit: 1 fetch asserted; 500 → identity+help only)_
- [x] Dogfooded against the live account. _(home view + self-cleaning timer cycle)_

## Risks / unknowns

- **>50 entries logged today** would under-count the today total from a single page — practically impossible; accepted.
- **List ordering** — Harvest returns newest-first by `spent_date`; confirmed live.

## Notes

- Returns a **plain object** (not pre-rendered blocks); the SDK merges the bin/description header and TOON-encodes it, so the `recent` array becomes a `recent[N]{...}` table automatically. Field insertion order = output order.
- Dropped literal quotes around the active-timer project/task — TOON quotes the whole value when needed, so wrapping caused ugly nested escaping (`\"...\"`). Spec example updated to match.
- One call fetches the 50 newest entries (`user_id` + `per_page=50`, no date filter); today/active-timer/last-entry/recent are all derived locally — keeps the per-session hook cost at a single request.

## Follow-ups

None.
