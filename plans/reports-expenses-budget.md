---
status: done
depends: [reports-uninvoiced]
specs:
  - specs/api/reports.md
  - specs/commands/reports.md
issues: []
---

# Plan: Reports — expenses + project budget

## Scope

**In:** `reports expenses <clients|projects|categories|team>` (server-aggregated expense totals over a window) and `reports budget` (point-in-time project budget vs. spent snapshot). **Out:** expense entry CRUD (the Expenses API itself — separate, not in scope).

## Implements

- `specs/api/reports.md` (Expense Reports, Project Budget Report) — `GET /v2/reports/expenses/{axis}` (from/to required, 365-day cap) and `GET /v2/reports/project_budget` (no window, `is_active`).
- `specs/commands/reports.md` (reports expenses, reports budget) — the subcommands, schemas, and where they sit among the report types.

## Approach

1. **Dispatch:** extend the `reports` type set to include `expenses` and `budget`. `expenses` takes a second positional axis (clients/projects/categories/team); `budget` takes none.
2. **expenses:** parse window via `parseRange` (default `this-month`), reuse `assertSpan`. `paginateAll("reports/expenses/${axis}", "results", { from, to })`. Totals: sum `total_amount` + `billable_amount`, capture currency (mixed → noted). Per-axis identity column (clients→client_name, projects→project_name+client_name, categories→expense_category_name, team→user_name). Sort by total_amount desc.
3. **budget:** no window — if date flags are passed, error (don't silently ignore) per the spec. `paginateAll("reports/project_budget", "results", { is_active: all ? undefined : true })`. Render `budget[N]{project,client,budget_by,budget,spent,remaining,active}` sorted by `remaining` asc. Always show `budget_by` (the unit differs hours vs money). `--all` includes inactive.
4. Reuse the shared 429/Reports-API-rate-limit handling (the tighter 100/15min applies).

## Validation

- [x] `reports expenses clients|projects|categories|team --from <d> --to <d>` each return aggregated `total_amount`/`billable_amount` with the right identity column, summed totals + currency, complete. _(unit: projects axis totals+sort+endpoint, categories identity column; live: endpoint reached, account has no expense data so returns definitive-empty — see note)_
- [x] `reports expenses` defaults to `this-month` when no window given; a > 365-day window → `VALIDATION_ERROR` (shared `assertSpan`). _(default via shared parseRange; assertSpan shared with time axes, unit-tested there)_
- [x] `reports budget` returns a per-project snapshot `{project,client,budget_by,budget,spent,remaining,active}` sorted by remaining asc; `--all` includes inactive, default active only. _(live: 10 projects, "Data Management System" -146.5h over budget on top, API Test 100/11.5/88.5; unit: sort + is_active=true default + --all drops the filter)_
- [x] `reports budget` with a date window flag → `VALIDATION_ERROR` (it takes no window) rather than silently ignoring it. _(live + unit: exit 2, no fetch)_
- [x] Empty results → definitive empty state; mixed currencies on expenses → header notes rather than summing. _(live: expenses empty state; unit: empty; mixed-currency uses the same shared pattern as time/uninvoiced)_
- [x] An unknown expenses axis (`reports expenses widgets`) → `VALIDATION_ERROR` listing the valid axes. _(live + unit; also no-axis case)_

## Risks / unknowns

- **`budget`/`spent`/`remaining` unit ambiguity** — hours vs money depends on `budget_by`; always rendering `budget_by` resolves it. Cross-check live against a known project (e.g. API Test has `budget_by: project_cost`, cost_budget 100).
- **Expense data may be sparse** on this account — if `reports expenses` returns empty live, that's a valid (definitive-empty) result, not a failure; the schema/sort still unit-tested with fixtures.
- **`budget` rejecting a window** is a slight asymmetry with the other report types; make the error explain why (snapshot, not a range).

## Notes

- **`budget` is the one report that takes no window** — it's a point-in-time snapshot. Passing a date flag is a fail-fast `VALIDATION_ERROR` (explaining it's a snapshot), not silently ignored, so the asymmetry with the other report types can't surprise. `--all` toggles the `is_active` filter.
- **`budget`/`spent`/`remaining` unit ambiguity resolved by always showing `budget_by`** — `project`/`task` budgets are in hours, `project_cost`/`*_fees` in money. Verified live: API Test (`project_cost`) reads 100/11.5/88.5 dollars, matching its `cost_budget` and the $11.50 we tracked; hours-based projects (`project`) read in hours. Sorted by `remaining` asc so over-budget projects (negative remaining) surface first — live, "Data Management System" shows -146.5h.
- **Expenses dogfooded against an empty result** — this account tracks no expenses, so the live path exercises the endpoint + definitive-empty state; the populated path (totals, per-axis identity column, sort) is unit-tested with fixtures. An honest gap, not a failure: empty is a valid answer here.
- **Shared `assertSpan` + `hasWindow` helpers** now serve time axes, uninvoiced, and expenses — one 365-day guard and one window-presence check, no duplication. `--all` was added to the shared `ReportsFlags`.
- +8 tests (expenses 5, budget 3); 134 total.

## Follow-ups

- The Expenses API (list/create/update/delete expense entries) remains unimplemented — these are the _reports_ over expenses, not expense management. Revisit if an expense-logging workflow is wanted.
