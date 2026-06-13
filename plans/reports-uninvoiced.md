---
status: planned
depends: [reports]
specs:
  - specs/api/reports.md
  - specs/commands/reports.md
issues: []
---

# Plan: Reports — uninvoiced report

## Scope

**In:** `reports uninvoiced --from <date> --to <date>` — per-project tracked hours + expenses **not yet invoiced**, over a window, with billable `$` amount. The bridge between `review`/`reports` (tracked) and `invoices` (billed). **Out:** the expense/project-budget reports (separate, not in scope here).

## Implements

- `specs/api/reports.md` (Uninvoiced Report section) — `GET /v2/reports/uninvoiced`, required `from`/`to`, 365-day cap, result fields.
- `specs/commands/reports.md` (reports uninvoiced section) — the subcommand, its required window, header, schema, and bridge suggestions.

## Approach

1. In `reports.ts`, add `uninvoiced` to the dispatch. It is **not** a time axis, so branch before the `reports/time/${axis}` path.
2. **Required window:** unlike the time axes (which default to `this-month`), `uninvoiced` has no default — if no `--from/--to`/named/`--since` was given, throw `VALIDATION_ERROR` naming the missing window. Reuse `parseRange` only when a window flag is present; otherwise error.
3. Reuse the existing **365-day `daySpan` guard** unchanged.
4. `paginateAll("reports/uninvoiced", "results", { from, to, include_fixed_fee? })`. Local totals: sum `uninvoiced_amount` (+ `uninvoiced_hours`), capture `currency` (mixed → noted, per the existing pattern).
5. Render: header (`range`, `report: uninvoiced`, total `uninvoiced_amount` + currency, `rows`, `complete`) + `uninvoiced[N]{project,client,hours,uninvoiced_hours,expenses,amount}` sorted by amount desc; definitive empty state; suggestions to `invoices create --from-tracked` and `review --unbilled`.

## Validation

- [ ] `reports uninvoiced --from <d> --to <d>` returns per-project uninvoiced hours/expenses/amount with a summed total + currency, paginated to completion.
- [ ] `reports uninvoiced` with no window → `VALIDATION_ERROR` naming the required `--from/--to` (no silent default), before any call.
- [ ] A window > 365 days → `VALIDATION_ERROR` (reuses the time-report guard).
- [ ] Empty result → definitive `0 ...` empty state; mixed currencies → header notes rather than summing.
- [ ] Suggestions bridge to `invoices create --from-tracked --project "<name>"` and `review --project "<name>" --unbilled`.

## Risks / unknowns

- **Cross-check vs the API test project** — the May-2026 entries on "API Test" are uninvoiced, so `reports uninvoiced --from 2026-05-01 --to 2026-05-31` should surface that project at $11.50 (matching the `--from-tracked` draft we built). A good live cross-validation.
- **Required-window UX** — make the error explicit that uninvoiced (unlike the time axes) needs a window, so the difference isn't surprising.

## Notes

_(to be filled at closeout)_

## Follow-ups

- Expense Reports and Project Budget Report remain unimplemented (separate Reports-API families); revisit if a budgeting/expense workflow is wanted.
