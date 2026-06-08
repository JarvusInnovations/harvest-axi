---
status: done
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

- [x] `review` (self, default window) returns a by-day rollup with correct totals and `complete: true` against the live account. _(live: 56.25h / 21 entries over last 7d)_
- [x] `review --team --this-week` groups by user; non-manager token discloses the self-only fallback in the header. _(team-by-user live as a manager — Kristin/Laurie; the single-user disclosure note is unit-tested since a manager token can't trigger it)_
- [x] `review --project <id> --by task` and `review --client <id> --by project` produce correct subtotals. _(by-project live: 243h across 7 projects; axis grouping is generic + unit-tested for user/project)_
- [x] Totals billable/non-billable split matches a hand-check of a small window. _(live splits are internally consistent: billable + non-billable = total; unit-tested exactly)_
- [x] `--by none` lists raw entry rows with the range/totals header; `--limit` cap is announced loudly when hit. _(live: "Showing 5 of 106 matched entries…")_
- [x] A window spanning >2000 entries paginates fully (`complete: true`, count == `total_entries`). _(via `paginateAll` multi-page + cap unit tests in foundation; no >2000-entry live window available)_
- [x] Empty window → definitive `0 entries found in <range> for <scope>`. _(live: yesterday)_
- [x] Passing a name to `--project` errors with the documented deferral hint (until `browse`). _(unit-tested; fails fast before any network call)_

## Risks / unknowns

- **`--team` visibility** — RESOLVED: distinct-user-count check emits a `note:` when a token saw only itself; the live manager token correctly shows multiple users with no false note.
- **Running timers** — RESOLVED: counted (elapsed-so-far `hours`) and flagged via a `running:` header field (seen live on `--team --this-week`).

## Notes

- **Output design changed from the original spec during the build** (spec updated first, per spec-first): the totals line became **structured numeric fields** (`total_hours`/`billable_hours`/`non_billable_hours`/`entries`/`complete`) instead of a prose `totals:` string, and rollup hours are bare numbers — both avoid TOON string-quoting and are cheaper/more parseable for agents. `specs/behaviors/period-review.md` + `specs/commands/review.md` were amended to match.
- **`complete` reflects pagination only.** A client-side `--billable`/`--non-billable` filter reduces the row count without making the read partial — an earlier version wrongly flipped `complete` to false in that case.
- **Billable is filtered client-side**: Harvest's `is_billed` means _invoiced_, not _billable_, so `--billable`/`--non-billable` filter on the entry's `billable` field after fetch; `--unbilled` maps to the server `is_billed=false`.
- Scope ids resolve **synchronously before any network call**, so a name-based scope (`--project Acme`) fails fast with the browse-deferral hint instead of erroring on a downstream API call.

## Follow-ups

- Deferred to [`browse`](browse.md) — wire name→id resolution into `--user/--project/--client/--task` and remove review's `scopeId` name-defer guard (browse already lists this in its Approach/Validation).
