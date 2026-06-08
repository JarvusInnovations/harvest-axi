---
status: done
depends: [auth-identity]
specs:
  - specs/commands/browse.md
issues: []
---

# Plan: Browse — reference data + name resolution

## Scope

**In:** `browse clients|projects|tasks|mine`, the on-disk name↔id resolution cache, and **wiring that resolution into `review`** (absorbing review's deferred name-resolution). **Out:** entry writes (`entries-write` consumes the resolver and assignment data this plan exposes).

## Implements

- `specs/commands/browse.md` — the four subcommands, their schemas, the cache (TTL + `--refresh`), case-insensitive substring resolution with exact-match precedence and ambiguity-as-error.

## Approach

1. `src/commands/browse.ts` + subdir — `clients` (`/v2/clients`), `projects` (`/v2/projects`, `--client` filter), `tasks` (`/v2/tasks`), `mine` (`/v2/users/me/project_assignments`, summarizing tasks per project).
2. `src/harvest/resolve.ts` — `resolveEntity(kind, nameOrId)` backed by a cache under `~/.config/harvest-axi/cache/`; numeric input passes through as id; name input → cached lookup, exact match wins, multiple substring hits → `VALIDATION_ERROR` listing candidates.
3. Wire `resolveEntity` into `review`'s `--user/--project/--client/--task` so names work end-to-end; remove review's deferral guard.

## Validation

- [x] `browse clients|projects|tasks|mine` each return correct minimal schemas + total + definitive empty state against the live account. _(live: 142 clients, 288 tasks, 16 assignments; empty unit-tested)_
- [x] `browse projects --client <name>` filters correctly. _(live: "Sound Transit" → 1 project, client_id resolved; unit-tested client_id=5)_
- [x] `browse mine` lists my assignable projects with their tasks — and matches what `entries log` will accept. _(live: 16 assignments with compact task lists)_
- [x] `resolveEntity` resolves an exact name, a unique substring, a numeric id; an ambiguous name returns candidates (not a guess). _(6 unit tests + live via review --client/--project)_
- [x] `review --project "<name>"` now resolves via the cache (review's deferral guard removed in this plan). _(live: --client "Sound Transit" and --project "GTFS Pathways" both resolved + rolled up)_

## Risks / unknowns

- **Cache staleness** — mitigated by a 1h TTL + `--refresh`; reference data (clients/projects/tasks) changes rarely.

## Notes

- **TTL chosen: 1 hour** (`TTL_MS` in `resolve.ts`). Cache lives at `~/.config/harvest-axi/cache/<kind>.json`. `--refresh` bypasses it on both `browse` and (when wired) review/entries.
- **Resolution covers `client|project|task|user`.** There's deliberately no `browse users` subcommand (not in spec), so `--user "<name>"` resolution still works via `/v2/users` but its not-found hint points to passing a numeric id; note `/v2/users` is manager-only (a non-manager gets a translated FORBIDDEN).
- **Removed `review`'s `scopeId` name-defer guard** and replaced it with `resolveEntity` for `--user/--project/--client/--task`; the review scope label now shows resolved names (e.g. `client Sound Transit`) instead of `#id`. Updated `review.test.ts` accordingly (the obsolete deferral test became a resolution test).
- This account has 142 active clients / 288 tasks — large enough that the cached lookup is a meaningful win over re-fetching per resolve.

## Follow-ups

- Deferred to [`entries-write`](entries-write.md) — `entries log/edit` consume the same `resolveEntity` for `--project/--task/--user` (already in that plan's Approach).
