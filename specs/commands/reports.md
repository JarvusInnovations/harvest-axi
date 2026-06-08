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

`harvest-axi reports <axis> [window] [flags]` — axis ∈ `clients | projects | tasks | team`.

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

## Suggestions

Point across axes (`reports tasks`/`reports team`) and down to `review --project "<name>" --by none` for the entries behind a row.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Review is the center of gravity](../principles.md#review-is-the-center-of-gravity) — reports complements review (money + wide windows); suggestions funnel back to `review` for entry detail.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) and [Human time in, stamped range out](../principles.md#human-time-in-stamped-range-out).
