# Behavior: Period review

The headline workflow. "Show me what was tracked over this window, scoped this way" — for myself, the whole team, a project, or a client — answered as **rollups first, raw rows on demand**.

## Rule

`review` resolves a **time window** (see [date-ranges](date-ranges.md)) and a **scope**, fetches all matching time entries paginated to completion, and reports pre-computed aggregates grouped along a chosen axis. The raw entries underlying any group are reachable but not dumped by default.

## Scope axes (mutually combinable filters)

Maps directly onto the [time_entries LIST filters](../api/time-entries.md#filters-all-optional-and-combined-server-side):

- **self** (default) — the authenticated user's entries (`user_id = me`).
- `--team` / `--all-users` — everyone (no `user_id`). Requires the token to have access; a non-manager token silently sees only itself, which the header must disclose.
- `--user <id|name>` — a specific user.
- `--project <id|name>` — one project.
- `--client <id|name>` — one client.
- `--task <id|name>` — one task.
- `--billable` / `--non-billable`, `--unbilled`, `--approval <status>` — refinements.

Name→id resolution for `--user/--project/--client/--task` uses the [browse](../commands/browse.md) resolution cache; an ambiguous name is a `VALIDATION_ERROR` listing candidates.

## Grouping

`--by <axis>` (default chosen from scope — see below). Axes: `user`, `project`, `client`, `task`, `day`, `none`.

- Default grouping: `--team`→`user`; `--project`→`task`; `--client`→`project`; self with no scope→`day`.
- `--by none` lists raw entry rows (still paginated to completion, still capped-with-disclosure if huge).

## Output shape

```
range: 2026-06-01 → 2026-06-07 (this-week)
scope: team (12 users)            # or: project "Acme Redesign" / client "Acme" / you
total_hours: 187.5
billable_hours: 162
non_billable_hours: 25.5
entries: 312
complete: true
by_user[12]{user,hours,billable,entries}:
  Chris Alfano,38.25,38.25,41
  ...
help[2]:
  Run `harvest-axi review --by project` to regroup
  Run `harvest-axi review --by none` to see the raw entries
```

- **The totals block is always present** — the answer to "how much" before any grouping — emitted as **structured numeric fields** (`total_hours`, `billable_hours`, `non_billable_hours`, `entries`), not a prose string, so an agent reads them without parsing and TOON renders them bare.
- **`complete: true`** confirms full pagination; if the hard safety cap is hit, `complete: false` is emitted alongside `capped_at_pages: N` and a narrowing hint. `complete` reflects **pagination only** — a client-side `--billable`/`--non-billable` filter reduces the row count without making the read partial.
- Group rows are sorted by hours descending; hours/billable are bare numbers rounded to 2 decimals.
- A `note:` field appears when `--team` was requested but the token returned only one user's data (manager/admin role needed); a `running:` field appears when any entry in the window has a live timer.

## Details

- Pagination follows `links.next` to completion (per_page 2000); `total_entries` validated against the count fetched.
- Hours use Harvest's `hours` (not `rounded_hours`) unless `--rounded` is passed; the header notes which.
- An empty result is a definitive `0 entries found in <range> for <scope>` — never ambiguous blank output.
- A running timer inside the window is included and flagged (its `hours` is the elapsed-so-far).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Review is the center of gravity](../principles.md#review-is-the-center-of-gravity) — this behavior *is* the center.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — drives totals-first, group-rows, raw-behind-`--by none`.
- [Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap) — the `complete:` marker.
- [Human time in, stamped range out](../principles.md#human-time-in-stamped-range-out) — the `range:` header.
