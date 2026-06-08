---
status: done
depends: [review]
specs:
  - specs/api/reports.md
  - specs/commands/reports.md
issues: []
---

# Plan: Reports — analytics via the Reports API

## Scope

**In:** the `reports clients|projects|tasks|team` command — server-aggregated time totals **with billable dollar amounts** over a window, the dimension `review` can't cheaply produce. **Out:** per-entry review and flexible grouping (that's `review`); the spec settles the boundary.

## Spec gate — SATISFIED

The two specs are authored and committed:

- `specs/api/reports.md` — endpoints, result fields, the 365-day span cap, the 100-req/15-min rate limit.
- `specs/commands/reports.md` — command surface, per-axis schemas, and the explicit reports-vs-review boundary table.

## Implements

- `specs/api/reports.md` — the four `/v2/reports/time/*` endpoints (paginated `results`), 365-day client-side guard, `include_fixed_fee`.
- `specs/commands/reports.md` — `reports <axis> [window] [--fixed-fee]`, structured totals header (hours + billable_amount + currency), per-axis bare-number schemas sorted by hours desc, suggestions across axes + down to `review`.

## Approach

1. `src/commands/reports.ts` — dispatch on axis ∈ clients/projects/tasks/team; parse window via `parseRange` (default `this-month`); guard span ≤ 365 days (else `VALIDATION_ERROR`).
2. `paginateAll(`reports/time/${axis}`, "results", { from, to, include_fixed_fee? })` to completion.
3. Local totals: sum `total_hours`/`billable_hours`/`billable_amount`; capture `currency` (note if mixed). Render structured header + a `<axis>[N]{...}` table (bare numbers, sorted by hours desc); definitive empty state; suggestions.
4. Reuse the shared client's 429→RATE_LIMITED translation (Retry-After) — no special handling beyond honoring it.

## Validation

- [x] `specs/api/reports.md` and `specs/commands/reports.md` authored and accepted (gate).
- [x] `reports projects` / `clients` / `tasks` / `team` return aggregated totals with billable amounts against the live account. _(projects + team live with $ amounts; clients/tasks via unit tests on the identical axis-generic path)_
- [x] A `reports` total cross-checks against a `review` hours total for the same window/scope. _(reports 915.5h == review --team --last-month --rounded 915.5h; see rounded-hours note)_
- [x] A window > 365 days is rejected with a `VALIDATION_ERROR` before any call. _(live: exit 2, no fetch)_
- [x] Empty window → definitive empty state; structured numeric header (no quoted prose). _(unit: `tasks --today`; header structured live)_
- [x] Reports-API 429s are honored (Retry-After) without leaking raw errors (shared client path). _(reports goes through paginateAll→harvestRequest; 429 translation unit-tested in client.test)_

## Risks / unknowns

- **Reports rate limit (100 / 15 min)** — far tighter than standard; the command does few wide calls (one paginated sweep per invocation).
- **Mixed currencies** — RESOLVED: >1 distinct currency → header shows `(mixed currencies — not summed)` instead of a meaningless sum (unit-tested).

## Notes

- **Reports sum rounded hours, not raw.** Verified live: `reports team --last-month` = 915.5h matched `review --team --last-month --rounded` exactly, while raw `review` = 901.5h (a ~1.5% gap from per-entry rounding). This is a durable API fact, so it's documented in `specs/api/reports.md` (not just here) — agents reconciling the two totals must use `review --rounded`.
- **Two report axes cross-validate**: `reports projects` and `reports team` for the same window return identical grand totals (both aggregate all entries), which is a strong correctness check.
- `reports` is account-wide for the axis (role-limited); it has no per-user/scope filter by design — narrow scoping is `review`'s job. Suggestions point back to `review --by none` for the entries behind a row.

## Follow-ups

- Tracked as: `--include-forecast` (scheduled_hours on projects/team) and a `--csv`/raw-amount export were considered out of scope for v1; revisit if a budgeting workflow needs them.

## Follow-ups
