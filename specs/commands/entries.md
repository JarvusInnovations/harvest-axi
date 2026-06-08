# Command: entries

Single-entry read + the write surface (create/edit/delete/timer). Implements [api/time-entries](../api/time-entries.md). Writes default to the authenticated user.

## Reads

- `entries today` / `entries yesterday` — shorthand for a flat self list on that day (range-stamped header, `entries[N]{id,project,task,hours,notes,running}`).
- `entries get <id>` — full detail of one entry: all readable fields, notes shown in full (self-contained detail view → no truncation, no suggestions per AXI principle 9).
- For period/scope listing, `review --by none` is the path (not duplicated here).

## Writes (self by default; `--user <id|name>` to act on another, where permitted)

- `entries log` — create. Required: `--project <id|name>` `--task <id|name>`. One of: `--hours <h>` (duration mode) or `--started <time> [--ended <time>]` (start/end mode). Optional: `--date <date>` (default today), `--notes <text>`. Omitting hours/ended creates a **running** entry. Returns the created entry's id + summary.
- `entries edit <id>` — PATCH supplied fields only: `--hours`, `--notes`, `--project`, `--task`, `--date`, `--started`, `--ended`. Unspecified fields untouched.
- `entries delete <id>` — delete. Idempotent: already-absent id → no-op exit 0. Locked/approved entry → `VALIDATION_ERROR` explaining why.
- `entries start <id>` / `entries stop <id>` — timer restart/stop. Idempotent: stopping a stopped entry (or starting a running one) is a no-op exit 0. `entries start` with no id but a `--project/--task` creates a new running entry (delegates to `log` without hours).

## Resolution

`--project/--task/--client/--user` accept names resolved via the [browse](browse.md) cache; ambiguous names → `VALIDATION_ERROR` listing candidates. Logging requires a project the user is assigned to and a task assigned to that project — a mismatch surfaces the assignment list.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — delete/start/stop no-ops, self-default, flags-only.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — 422 from Harvest surfaces the rejected field + the assignment fix.
