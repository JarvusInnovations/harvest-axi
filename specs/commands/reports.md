# Command: reports

Server-aggregated time totals with **billable dollar amounts**, over a window, by client / project / task / team. Implements [api/reports](../api/reports.md) and [behaviors/date-ranges](../behaviors/date-ranges.md).

## reports vs review (the boundary)

Both summarize tracked time over a period; they differ in source and strength:

| | `review` | `reports` |
|---|---|---|
| Source | raw `time_entries`, rolled up locally | server-aggregated Reports API |
| Money | ✗ (hours only) | ✓ `billable_amount` per row |
| Grouping | any axis incl. `day`, + raw `--by none` rows | fixed: clients / projects / tasks / team |
| Scope | self/team/user/project/client/task, name-resolved, refinements | account-wide for the axis (role-limited) |
| Window | unbounded | **≤ 365 days** |
| Cost | one entry per row fetched | one aggregated row per entity |

Use **`review`** for the personal/daily loop, flexible grouping, and entry drill-down. Use **`reports`** for wide-window, account-wide, money-aware summaries cheaply.

## Invocation

`harvest-axi reports <type> [window] [flags]` — type ∈ `clients | projects | tasks | team | uninvoiced | expenses | budget`.

- `clients | projects | tasks | team` — **time** reports (aggregated tracked hours + billable $).
- `uninvoiced` — tracked work **not yet invoiced** (see below).
- `expenses <axis>` — **expense** totals by `clients | projects | categories | team` (see below).
- `budget` — a point-in-time **project budget** snapshot (see below).

## Flags

```
time window (see date-ranges; default: this-month):
  --since <dur> | --from <date> --to <date> | --this-month/--last-month/--this-week/...
  --fixed-fee          include billable amounts for fixed-fee projects (include_fixed_fee)
```

## Output

```
range: 2026-06-01 → 2026-06-30 (this-month)
report: projects
total_hours: 412.5
billable_hours: 388
billable_amount: 58200 USD
rows: 9
complete: true
projects[9]{project,client,hours,billable_hours,amount}:
  Transit Data Process Management,Sound Transit,151.25,151.25,22687.5
  ...
help[2]:
  Run `harvest-axi reports tasks --this-month` to break down by task
  Run `harvest-axi review --project "<name>" --by none` for the underlying entries
```

- Header: `range`, `report` (axis), structured totals (`total_hours`, `billable_hours`, `billable_amount` + `currency`), `rows`, `complete` — same numeric-not-prose discipline as `review`.
- Default schema per axis (hours/amounts as bare numbers, sorted by hours desc):
  - clients: `{ client, hours, billable_hours, amount }`
  - projects: `{ project, client, hours, billable_hours, amount }`
  - tasks: `{ task, hours, billable_hours, amount }`
  - team: `{ user, hours, billable_hours, amount }`
- `billable_amount` sums assume a single account currency; if rows report mixed currencies, the header notes it rather than summing across them.
- A window > 365 days → `VALIDATION_ERROR` (narrow it). Empty result → definitive `0 ... in <range>`.

## reports uninvoiced

`harvest-axi reports uninvoiced --from <date> --to <date>` — per-project tracked work not yet on an invoice. Implements the [uninvoiced report](../api/reports.md#uninvoiced-report).

- **`--from`/`--to` (or a named window/`--since`) are required** — unlike the time axes, there is no `this-month` default (the API requires an explicit range). A bare `reports uninvoiced` → `VALIDATION_ERROR` naming the missing window.
- Same **365-day** cap (reuses the time-report guard).
- Header: `range`, `report: uninvoiced`, `uninvoiced_amount` total (+ currency; mixed → noted), `rows`, `complete`.
- Rows sorted by `uninvoiced_amount` desc: `uninvoiced[N]{project,client,hours,uninvoiced_hours,expenses,amount}`.
- Suggestions point to `invoices create --from-tracked --project "<name>"` (turn the uninvoiced work into a draft) and `review --project "<name>" --unbilled` (the entries behind a row).

This is the natural bridge between `review`/`reports` (what was tracked) and `invoices` (what was billed): it answers "what's billable but not yet invoiced."

## reports expenses

`harvest-axi reports expenses <clients|projects|categories|team> [window]` — server-aggregated expense totals. Implements the [expense reports](../api/reports.md#expense-reports).

- **Requires a window** (`--from/--to`, named, or `--since`) like the time axes default to `this-month` — expenses default to `this-month` too (the API requires from/to; we supply the default). Same **365-day** cap.
- Header: `range`, `report: expenses <axis>`, `total_amount` + `billable_amount` (+ currency; mixed → noted), `rows`, `complete`.
- Rows sorted by `total_amount` desc, per-axis identity column: clients→`client`, projects→`project`+`client`, categories→`category`, team→`user`. Schema `{<id>,total,billable}`.

## reports budget

`harvest-axi reports budget [--all]` — a point-in-time snapshot of budget vs. spent per project. Implements the [project budget report](../api/reports.md#project-budget-report).

- **Takes no window** (it's current state, not a range); passing date flags is ignored/rejected rather than silently misapplied. `--all` includes inactive projects (default active only, via `is_active`).
- Header: `report: budget`, `rows`, `complete` (no range — note `snapshot: <date>` is acceptable but not a filter).
- Rows: `budget[N]{project,client,budget_by,budget,spent,remaining,active}`, sorted by `remaining` asc (most over/at-risk first). Because `budget`/`spent`/`remaining` are hours **or** money depending on `budget_by`, that column is always shown so the unit is legible.
- Suggestion: point to `reports projects` / `review --project` for the hours behind a budget.

## Suggestions

Point across axes (`reports tasks`/`reports team`), to `reports uninvoiced` for unbilled work, `reports expenses <axis>` for costs, `reports budget` for budget health, and down to `review --project "<name>" --by none` for the entries behind a row.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Review is the center of gravity](../principles.md#review-is-the-center-of-gravity) — reports complements review (money + wide windows); suggestions funnel back to `review` for entry detail.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) and [Human time in, stamped range out](../principles.md#human-time-in-stamped-range-out).
