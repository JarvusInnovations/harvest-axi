---
status: planned
depends: [auth-identity]
specs:
  - specs/behaviors/period-review.md
  - specs/behaviors/date-ranges.md
  - specs/commands/review.md
issues: []
---

# Plan: Review — period-based time-entry rollups (the headline)

## Scope

The centerpiece command. **In:** `review` over a resolved window × scope, paginated to completion, reported as totals-first rollups grouped by a chosen axis, with `--by none` for raw rows. Scope by **id** (`--user/--project/--client/--task <id>`), `--team`/self, and refinements (`--billable`, `--unbilled`, `--approval`). **Out:** **name** resolution for scope flags (`--project Acme`) — deferred to `browse`, which owns the resolution cache; until then names error with a "pass the id / see `browse`" hint. Reports-API-based analytics → `reports`.

## Implements

- `specs/commands/review.md` — flags, default/`--by` grouping, default schemas, suggestions, examples.
- `specs/behaviors/period-review.md` — scope axes, grouping defaults, totals/`complete:` header, sorting, empty state, running-timer inclusion.
- `specs/behaviors/date-ranges.md` — consumes `time/ranges.ts` (built in `foundation`).

## Approach

1. `src/commands/review.ts` — parse window (via `parseRange`, default `--since 7d` self / this-week team), scope flags, refinements, `--by`, `--rounded`, `--limit`, `--fields`.
2. Build the `time_entries` query (`from`/`to` + `user_id`/`project_id`/`client_id`/`task_id` + `is_billed`/`approval_status`); self default sets `user_id = default_user_id`; `--team` omits it.
3. `paginateAll('time_entries', query)` → entries + `total_entries` + `complete`.
4. Local rollup: group by the chosen axis, sum `hours` (or `rounded_hours`), split billable/non-billable, count entries; sort desc by hours. Compute the always-present `totals:`.
5. Render: `range:`/`scope:`/`totals:`(+`complete:`) header object, then `by_<axis>[N]{...}` table (or `entries[N]{...}` for `--by none`), then suggestions (regroup / drill / narrow). Definitive empty state.
6. Scope **name** inputs detected → `VALIDATION_ERROR` "name resolution lands with `browse`; pass --project <id> for now (find ids via the live account)". (Absorbed/cleared by `browse`.)

## Validation

- [ ] `review` (self, default window) returns a by-day rollup with correct totals and `complete: true` against the live account.
- [ ] `review --team --this-week` groups by user; non-manager token discloses the self-only fallback in the header.
- [ ] `review --project <id> --by task` and `review --client <id> --by project` produce correct subtotals.
- [ ] Totals billable/non-billable split matches a hand-check of a small window.
- [ ] `--by none` lists raw entry rows with the range/totals header; `--limit` cap is announced loudly when hit.
- [ ] A window spanning >2000 entries paginates fully (`complete: true`, count == `total_entries`).
- [ ] Empty window → definitive `0 entries found in <range> for <scope>`.
- [ ] Passing a name to `--project` errors with the documented deferral hint (until `browse`).

## Risks / unknowns

- **`--team` visibility** — depends on the token's role. A non-manager silently sees only self; the header must say so. Detect by comparing returned distinct user_ids to the requested scope.
- **Running timers** — `hours` reflects elapsed-so-far; ensure they're counted and flagged, not dropped.

## Notes

## Follow-ups
