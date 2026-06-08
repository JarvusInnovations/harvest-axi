---
status: done
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
4. Read `profile_cache.wants_timestamp_timers` (cached at `auth setup`) to pick the account's mode — duration (`--hours`) vs start/end (`--started/--ended`) — and, when the wrong mode's flags are passed, fail with a `VALIDATION_ERROR` naming the mode this account uses (deferred from [`auth-identity`](auth-identity.md); this account is currently duration-mode).

## Validation

- [x] `entries log --project <id> --task <id> --hours 1.5 --notes "..."` creates an entry and returns its id + summary. _(live self-cleaning cycle: created id 2944187726)_
- [x] `entries log` honors the account's timer mode from `profile_cache.wants_timestamp_timers`, rejecting the wrong-mode flags with a clear message (deferred from [`auth-identity`](auth-identity.md)). _(unit-tested: duration-mode account rejects --started before any lookup)_
- [x] `entries log` without hours creates a running entry; `entries stop <id>` stops it; second `stop` is a no-op exit 0. _(live: start→running, stop→stopped, stop again→no-op)_
- [x] `entries edit <id> --notes "..."` changes only notes; other fields untouched. _(live + unit: PATCH body == {notes})_
- [x] `entries delete <id>` deletes; deleting an absent id is a no-op exit 0; a locked/approved entry → `VALIDATION_ERROR`. _(live: delete→deleted, delete again→no-op; locked-entry path is the generic 422 translation, not separately triggered live)_
- [x] `entries get <id>` shows full detail with complete notes. _(live + unit: 300-char notes untruncated)_
- [x] Logging a task not assigned to the project surfaces the assignment-fix hint (not a raw 422). _(client 422 → VALIDATION_ERROR with a `browse mine` hint; not triggered live since the smoke task was validly assigned)_
- [x] Writes default to me; `--user <name>` resolves and targets another (where role permits). _(self-default live via the cycle; `--user` resolves through the same resolveEntity path)_

## Risks / unknowns

- **Duration vs start/end account mode** — RESOLVED: read from `profile_cache.wants_timestamp_timers` (cached at setup); wrong-mode flags are rejected up front. This account is duration-mode and the live cycle used `--hours`.

## Notes

- **Self-cleaning live validation**: created one 0.01h entry on "Non-billable Work / Business Development", exercised edit/start/stop/delete + both idempotent no-ops, and confirmed a post-delete `get` returns NOT_FOUND. Net zero — nothing left on the real timesheet.
- **Found & fixed a leak during dogfooding** (committed separately): the 404 path was appending the raw JSON body (`{"status":404,...}`) to the error message. `translateHarvestError` now surfaces only a human field (`message`/`error_description`/`error`) and never dumps the raw JSON — code brought into conformance with the existing `api/conventions.md` "never leak raw API noise" rule (no spec change needed). Regression test added.
- **start/stop read-before-act**: each does a GET to check `is_running` so the already-in-target-state case is a true no-op (one extra GET, but correct idempotency).
- Locked/approved-delete and task-not-assigned-422 paths rely on the generic client error translation; not separately triggered live (the smoke entry was unlocked and validly assigned).

## Follow-ups

- None.
