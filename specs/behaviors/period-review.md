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
totals: 187.50h  (162.00h billable, 25.50h non-billable)  · 312 entries · complete: true
by_user[12]{user,hours,billable,entries}:
  Chris Alfano,38.25,38.25,41
  ...
help[2]:
  Run `harvest-axi review --by project` to regroup
  Run `harvest-axi review --by none` to see the raw entries
```

- **`totals:`** is always present — the answer to "how much" before any grouping.
- **`complete: true`** confirms full pagination; if a hard safety cap is ever hit, it flips to `complete: false (capped at N)` with a narrowing hint.
- Group rows are sorted by hours descending.
- Billable split is always shown in totals; per-group billable column appears when meaningful.

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
