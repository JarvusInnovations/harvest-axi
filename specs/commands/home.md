# Command: home (no args)

## Invocation

`harvest-axi` with no arguments. Also the SessionStart hook payload.

## Purpose

Per AXI "content first": running bare shows **live, actionable state**, not help text. Per the [review center-of-gravity](../principles.md#review-is-the-center-of-gravity), it orients the agent toward today's tracking and the review entry point — with the **minimum** API cost since this loads every session.

## Data

- Identity (from config / `users/me` cache): the authenticated user's name + the account name.
- Today's own entries: total hours today, count, and whether a timer is running (one `time_entries?from=today&to=today&user_id=me` call).
- Setup state when unconfigured (no token).

## Output (configured)

```
bin: ~/.local/bin/harvest-axi
description: AXI CLI for Harvest time tracking — review, log, and edit time entries.
account: Jarvus Innovations
user: Chris Alfano
today: 5.25h across 3 entries · timer running on "Acme Redesign / Development"
help[3]:
  Run `harvest-axi review --since 7d` to review your last week
  Run `harvest-axi review --team --this-week` to review the whole team
  Run `harvest-axi entries today` to see today's entries, or `start` to begin a timer
```

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
