---
name: harvest-axi
description: >-
  Review, log, and edit Harvest time entries from the terminal. Use when asked
  to review tracked time over a period (for yourself, the team, a project, or a
  client), summarize hours, check today's entries or a running timer, log time,
  or edit/delete timesheet entries. Triggers on "Harvest", "time entries",
  "timesheet", "how many hours", "log time", "review my week", "billable hours".
---

# harvest-axi

An [AXI](https://axi.md)-compliant CLI for [Harvest](https://www.getharvest.com/) time tracking. Token-efficient [TOON](https://toonformat.dev/) output, human date ranges in / year-stamped ranges out, paginate-to-completion reads, idempotent edits.

> This skill is static. For live state at session start (today's hours, running timer), install the SessionStart hook instead (see the project README) — the hook and this skill are two paths to the same tool; you only need one.

If `harvest-axi` is on PATH, use it directly; otherwise prefix examples with `npx -y harvest-axi`.

## Setup (once)

```sh
harvest-axi auth setup --token <personal-access-token>
```

Mint a token at <https://id.getharvest.com/developers>. The account id is auto-selected when your token sees exactly one Harvest account. Verify with `harvest-axi doctor`.

## Review — the headline

`review` answers "what was tracked over this window, scoped this way", as totals-first rollups.

```sh
harvest-axi review                                  # your last 7 days, by day
harvest-axi review --team --this-week               # everyone this week, by user
harvest-axi review --client "Acme" --last-month --by project
harvest-axi review --project "GTFS Pathways" --by task --unbilled
harvest-axi review --since 2w --by none             # raw entry rows
```

- Window: `--since 7d|2w|1m`, `--from/--to`, or `--today/--yesterday/--this-week/--last-week/--this-month/--last-month`.
- Scope: default = you; `--team`; or `--user/--project/--client/--task <id|name>` (names resolve via the cache).
- `--by user|project|client|task|day|none`. Output leads with `total_hours`/`billable_hours`/`non_billable_hours`/`entries`/`complete`.

## Browse — reference data (and what you can log against)

```sh
harvest-axi browse mine          # your assignable projects + their tasks
harvest-axi browse clients
harvest-axi browse projects --client "Acme"
harvest-axi browse tasks
```

## Entries — read and edit your time

```sh
harvest-axi entries today
harvest-axi entries get <id>
harvest-axi entries log --project "<name>" --task "<name>" --hours 1.5 --notes "..."
harvest-axi entries edit <id> --notes "..."
harvest-axi entries start <id>     # / stop <id>
harvest-axi entries delete <id>
```

Writes default to your own entries. `delete`/`start`/`stop` are idempotent (already-in-target-state is a no-op). On most accounts you log with `--hours` (duration mode); some use `--started/--ended` (the CLI tells you which).

## Getting help

Run `harvest-axi` (no args) for live state, or `harvest-axi <command> --help` for any command's full flag reference.
