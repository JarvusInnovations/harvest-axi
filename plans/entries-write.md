---
status: planned
depends: [auth-identity, browse]
specs:
  - specs/commands/entries.md
  - specs/api/time-entries.md
issues: []
---

# Plan: Entries — detail read + write surface

## Scope

**In:** `entries today|yesterday` (flat self reads), `entries get <id>` (full detail), and the write surface — `entries log` (create, duration & start/end modes), `entries edit <id>` (PATCH), `entries delete <id>`, `entries start|stop <id>` (timers). Self by default; `--user` to act on another where permitted. **Out:** period/scope listing (that's `review --by none`).

## Implements

- `specs/commands/entries.md` — all read + write subcommands, self-default, idempotent delete/start/stop, name resolution via `browse`'s resolver, assignment-mismatch error surfacing.
- `specs/api/time-entries.md` — the create/update/delete/timer endpoints (the write half the foundation client left generic).

## Approach

1. `src/commands/entries.ts` + subdir. Reads: `today`/`yesterday` build a self `time_entries?from&to&user_id` call; `get <id>` fetches one entry, full notes, no truncation/suggestions (self-contained detail).
2. Writes resolve `--project/--task/--user` via `resolveEntity`. `log` enforces required `--project`+`--task` and one of `--hours` / `--started`; omitting hours/ended → running entry. `edit` PATCHes only supplied fields. `delete` is idempotent (absent id → no-op exit 0). `start`/`stop` map to `/restart` & `/stop`, no-op when already in target state.
3. 422 from Harvest (e.g. task not assigned to project) → `VALIDATION_ERROR` surfacing the rejected field + a `browse mine` hint.

## Validation

- [ ] `entries log --project <id> --task <id> --hours 1.5 --notes "..."` creates an entry and returns its id + summary.
- [ ] `entries log` without hours creates a running entry; `entries stop <id>` stops it; second `stop` is a no-op exit 0.
- [ ] `entries edit <id> --notes "..."` changes only notes; other fields untouched.
- [ ] `entries delete <id>` deletes; deleting an absent id is a no-op exit 0; a locked/approved entry → `VALIDATION_ERROR`.
- [ ] `entries get <id>` shows full detail with complete notes.
- [ ] Logging a task not assigned to the project surfaces the assignment-fix hint (not a raw 422).
- [ ] Writes default to me; `--user <name>` resolves and targets another (where role permits).

## Risks / unknowns

- **Duration vs start/end account mode** — accounts are configured for one; detect from `users/me` or the create response and guide the agent if the wrong mode's flags were passed.

## Notes

## Follow-ups
