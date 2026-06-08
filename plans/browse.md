---
status: planned
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

- [ ] `browse clients|projects|tasks|mine` each return correct minimal schemas + total + definitive empty state against the live account.
- [ ] `browse projects --client <name>` filters correctly.
- [ ] `browse mine` lists my assignable projects with their tasks — and matches what `entries log` will accept.
- [ ] `resolveEntity` resolves an exact name, a unique substring, a numeric id; an ambiguous name returns candidates (not a guess).
- [ ] `review --project "<name>"` now resolves via the cache (review's deferral guard removed in this plan).

## Risks / unknowns

- **Cache staleness** — archived/renamed projects; short TTL + `--refresh` mitigates. Note chosen TTL.

## Notes

## Follow-ups
