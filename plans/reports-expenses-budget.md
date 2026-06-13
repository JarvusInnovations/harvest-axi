---
status: planned
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

- [ ] `reports expenses clients|projects|categories|team --from <d> --to <d>` each return aggregated `total_amount`/`billable_amount` with the right identity column, summed totals + currency, complete.
- [ ] `reports expenses` defaults to `this-month` when no window given; a > 365-day window → `VALIDATION_ERROR` (shared `assertSpan`).
- [ ] `reports budget` returns a per-project snapshot `{project,client,budget_by,budget,spent,remaining,active}` sorted by remaining asc; `--all` includes inactive, default active only.
- [ ] `reports budget` with a date window flag → `VALIDATION_ERROR` (it takes no window) rather than silently ignoring it.
- [ ] Empty results → definitive empty state; mixed currencies on expenses → header notes rather than summing.
- [ ] An unknown expenses axis (`reports expenses widgets`) → `VALIDATION_ERROR` listing the valid axes.

## Risks / unknowns

- **`budget`/`spent`/`remaining` unit ambiguity** — hours vs money depends on `budget_by`; always rendering `budget_by` resolves it. Cross-check live against a known project (e.g. API Test has `budget_by: project_cost`, cost_budget 100).
- **Expense data may be sparse** on this account — if `reports expenses` returns empty live, that's a valid (definitive-empty) result, not a failure; the schema/sort still unit-tested with fixtures.
- **`budget` rejecting a window** is a slight asymmetry with the other report types; make the error explain why (snapshot, not a range).

## Notes

_(to be filled at closeout)_

## Follow-ups

- The Expenses API (list/create/update/delete expense entries) remains unimplemented — these are the _reports_ over expenses, not expense management. Revisit if an expense-logging workflow is wanted.
