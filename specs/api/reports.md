# API: Time Reports

Source: <https://help.getharvest.com/api-v2/reports-api/reports/time-reports/>. Server-side aggregated time totals — including billable **amounts** (money), which the raw `time_entries` endpoint does not roll up.

## Endpoints

All take required `from` + `to` dates and paginate like other list endpoints (`results` array + `total_entries`/`total_pages`/`links`).

| Endpoint | Path | Result rows keyed by |
|----------|------|----------------------|
| Clients | `GET /v2/reports/time/clients` | client |
| Projects | `GET /v2/reports/time/projects` | project (+ client) |
| Tasks | `GET /v2/reports/time/tasks` | task |
| Team | `GET /v2/reports/time/team` | user |

### Common result fields

`total_hours` · `billable_hours` · `currency` · `billable_amount` (decimal money). Plus per-type identity:

- **clients:** `client_id`, `client_name`
- **projects:** `project_id`, `project_name`, `client_id`, `client_name`, `scheduled_hours?` (with `include_forecast`)
- **tasks:** `task_id`, `task_name`
- **team:** `user_id`, `user_name`, `weekly_capacity` (seconds), `is_contractor`, `avatar_url`, `scheduled_hours?`

> **Reports sum _rounded_ hours** (per the account's rounding settings), **not** raw `hours`. Verified live: `reports team --last-month` = 915.5h matched `review --team --last-month --rounded` exactly, while raw `review` reported 901.5h. A `reports` total therefore cross-checks against `review` only when `review` uses `--rounded`.

### Optional params

- `include_fixed_fee` — include billable amounts for fixed-fee projects (off by default).
- `include_forecast` (projects/team) — adds `scheduled_hours`.
- `page` / `per_page` (1–2000, default 2000).

## Constraints

- **Date span ≤ 365 days** — "The timeframe supplied cannot exceed 1 year." A wider request must be rejected client-side before the call.
- **Rate limit** — the Reports API is throttled far tighter than standard: **100 requests / 15 minutes** (vs 100 / 15s). Design for few, wide calls; a 429 carries `Retry-After` (handled by the shared client).
- **Permissions** — Administrators see all; Managers see managed projects/teams; Members see only their own tracked time. A Member calling `reports team` sees just themselves.

## Relationship to `time_entries`

The Reports API returns **pre-aggregated** rows (one per entity) — cheap and money-aware, but with no per-entry drill-down, fixed aggregation axes, and the 365-day cap. The `time_entries` endpoint (see [time-entries](time-entries.md)) is the per-entry source `review` uses for flexible grouping and raw rows. See [commands/reports](../commands/reports.md) for how the two commands divide the work.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — Reports _is_ the server-side rollup; surface its totals, point to `review` for entry-level detail.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — the 365-day cap is enforced as a `VALIDATION_ERROR` before calling; 429 honors `Retry-After`.
