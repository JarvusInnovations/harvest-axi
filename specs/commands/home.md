# Command: home (no args)

## Invocation

`harvest-axi` with no arguments. Also the SessionStart hook payload.

## Purpose

Per AXI "content first": running bare shows **live, actionable state**, not help text. Per the [review center-of-gravity](../principles.md#review-is-the-center-of-gravity), it orients the agent toward today's tracking and the review entry point — with the **minimum** API cost since this loads every session.

## Data

- Identity (from config / `users/me` cache): the authenticated user's name + the account name.
- The user's recent own entries: **one** `time_entries?user_id=me&per_page=50` call (Harvest returns newest-first by `spent_date`). Everything below is derived from this single response:
  - **active timer** — the entry with `is_running: true`, if any (its `hours` is elapsed-so-far).
  - **today** — hours summed over entries whose `spent_date` is today, with count.
  - **last entry** — the most recent entry's `spent_date`, rendered with a relative "(N days ago)".
  - **recent** — the last 3 entries (date, project, task, hours).
- Setup state when unconfigured (no token).

## Output (configured)

```
bin: ~/.local/bin/harvest-axi
description: AXI CLI for Harvest time tracking — review, log, and edit time entries.
account: Jarvus Innovations
user: Chris Alfano
active_timer: GTFS Pathways / T2: Project Management — 1.25h elapsed
today: 5.25h across 3 entries
last_entry: 2026-06-05 (3 days ago)
recent[3]{spent_date,project,task,hours}:
  2026-06-05,GTFS Pathways Development,T2: Project Management,2
  2026-06-05,Non-billable Work,Business Development,1.5
  2026-06-04,Non-billable Work,Internal Meetings,1.75
help[3]:
  Run `harvest-axi review --since 7d` to review your last week
  Run `harvest-axi entries today` to see today's entries, or `start`/`stop` a timer
  Run `harvest-axi review --team --this-week` to review the whole team
```

Rules:

- `active_timer` is **omitted** when no timer is running (don't print an empty/false line).
- `today` reads `nothing logged yet` when there are no entries dated today.
- `last_entry` relative label: 0 days → `today`, 1 → `yesterday`, else `N days ago`. Omitted when the user has no entries at all.
- `recent` shows up to 3; omitted when there are no entries.
- Stays at **one** API call; on failure the live block is dropped and identity + suggestions still render.

## Output (unconfigured)

```
bin: ~/.local/bin/harvest-axi
description: ...
setup: no Harvest credentials configured
help[1]:
  Run `harvest-axi auth setup` to connect your Harvest account (Personal Access Token + Account ID)
```

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Review is the center of gravity](../principles.md#review-is-the-center-of-gravity) — the suggestions lead with `review`.
- Token-budget discipline (AXI principle 7): at most one live API call (today's entries); everything else is cached/config.
