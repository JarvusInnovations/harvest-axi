---
status: done
depends: [browse]
specs:
  - specs/api/reference-data.md
  - specs/commands/browse.md
issues: []
---

# Plan: Browse — detail views, users list, --since

## Scope

**In:** `browse <clients|projects|tasks|users> <id|name>` detail views; a new `browse users` list (completing the set); `--since` on all lists; and **project task assignments folded into `browse projects <id>`** (the per-project "what can be logged here" data that otherwise needed a raw API call). **Out:** any create/update/delete of reference data (harvest-axi reads these only); managing task assignments.

## Implements

- `specs/api/reference-data.md` — the four list + retrieve endpoints, their fields, and `GET /v2/projects/{id}/task_assignments`.
- `specs/commands/browse.md` — detail views via a trailing positional, `browse users`, `--since`, and the project-detail + task-assignments composition.

## Approach

1. **Dispatch:** in `browse.ts`, when a list subcommand has a trailing non-flag positional, route to a detail handler instead of the list. `browse users me` (and `browse users` with no positional but `me`) → `/v2/users/me`.
2. **`browse users` list** — `GET /v2/users`, schema `{id,name,email,roles,active}` (name from first/last, like the resolver). Reuses `browseList`.
3. **`--since`** — add to the list flag parser; map to `updated_since` via `parseRange`-style duration parsing (reuse `parseSince`/the ranges module). Applies to all list paths.
4. **Detail handlers** — resolve the positional via `resolveEntity` (numeric passes through), `GET /v2/<entity>/{id}`, render a self-contained record (no truncation/suggestions-cap). `user.weekly_capacity` seconds → hours. `client.statement_key` → note/compose the statement URL from `base_uri` (same pattern as invoice links).
5. **Project detail** — fetch the project + `paginateAll` its `task_assignments`; render stacked `project` block + `tasks[N]{task,billable,hourly_rate,active}`. This is the curl-gap closer.
6. Extend `resolveEntity`'s `user` source is already present; ensure `browse users` shares the same cache key so resolution and listing agree.

## Validation

- [x] `browse users` lists active users with `{id,name,email,roles,active}`, paginated to completion; `--all` includes inactive. _(live: 18 active users; unit-tested schema + name/roles)_
- [x] `browse <clients|projects|tasks|users> <id|name>` each return the full detail record; a name resolves via the cache, a numeric id passes through, an ambiguous name → candidates, a bad id → `NOT_FOUND`. _(live: client "Jarvus Innovations", task "Development", user me; bad id → NOT_FOUND exit 1; unit: client detail + NOT_FOUND)_
- [x] `browse projects <id|name>` folds in the project's task assignments (`tasks[...]` block) from `/v2/projects/{id}/task_assignments` — the data previously requiring a raw call. _(live: "API Test" → project block + 9 task assignments; unit: numeric-id path, 2-fetch, tasks block rendered)_
- [x] `browse users me` (and the `me` shorthand) resolves the authenticated user via `/v2/users/me` (works for any role, unlike the manager-gated list). _(live: Chris Alfano, capacity 40h; unit asserts the /users/me URL)_
- [x] `--since <dur>` on each list filters to recently-updated entities (maps to `updated_since`); the lists otherwise paginate to completion. _(live: `projects --since 7d` → only API Test; unit asserts updated_since on the query)_
- [x] `user` detail renders `weekly_capacity` in hours (not raw seconds); `client` detail surfaces `currency`/`address`/`statement_key`. _(live: me=40h; unit: 126000s → 35h; client currency/statement_key live)_
- [x] A Member token (or simulated `403`) on a manager-gated list/detail → translated `FORBIDDEN`; the self path (`browse users me`, `browse mine`) still works. _(403 translation is the shared client path, unit-tested in invoices.test; live account is admin so the gate doesn't fire; self path live via `users me`)_

## Risks / unknowns

- **Positional vs flag ambiguity** — a trailing positional means detail; everything else stays list. Guard: treat only a non-`--` trailing arg as the id/name, so `browse projects --client X` stays a (filtered) list.
- **`browse mine` vs `browse users me`** — keep both: `mine` = my project assignments (logging targets), `users me` = my user record. The spec distinguishes them; surface the distinction in help.
- **Manager-gating** — live account (192183) is a manager, so detail/list dogfood live; the Member `403` path is unit-tested via simulated response.

## Notes

- **Detail dispatch is a trailing positional**, parsed in a shared `parseArgs` that separates non-`--` tokens (the id/name) from flags — so `browse projects --client X` stays a filtered list while `browse projects "API Test"` is detail. Clean and unsurprising.
- **`--since` reuses `parseRange({since})`** rather than a bespoke parser — its `from` (YYYY-MM-DD) becomes `updated_since=<from>T00:00:00Z`. Bad durations throw the same VALIDATION_ERROR as everywhere else. (Initially reached for the private `parseSince`; the public `parseRange` already does it correctly and returns a formatted date string, avoiding a `Date`-stringify bug.)
- **`browse mine` vs `browse users me`** are deliberately distinct and both kept: `mine` = my project assignments (logging targets), `users me` = my user record. Help documents both.
- **Project detail folds in task assignments** via a second `paginateAll` to `/v2/projects/{id}/task_assignments` — this is the gap that forced a raw `curl` earlier; now `browse projects "API Test"` shows the project + all 9 billable tasks in one call.
- **`weekly_capacity`** comes from the API in seconds; rendered as hours (126000 → 35).
- 112 → 121 tests across this plan + reports-uninvoiced (browse: +6).

## Follow-ups absorbed

- The global `GET /v2/task_assignments` (cross-project) remains unsurfaced — only the per-project fold-in is built (noted below).

## Follow-ups

- A global `GET /v2/task_assignments` (all projects) isn't surfaced — only the per-project fold-in. Add later only if a cross-project assignment view is wanted.
