---
status: planned
depends: []
specs:
  - specs/architecture.md
  - specs/api/conventions.md
  - specs/api/time-entries.md
  - specs/behaviors/date-ranges.md
issues: []
---

# Plan: Foundation — runtime, client, output, date parsing

## Scope

The reusable substrate every command sits on. **In:** project wiring (`bin/`, `cli.ts` via `runAxiCli`, top-level help, version), config/state module, the authed Harvest HTTP client (headers, error translation, pagination-to-completion), the TOON output helpers (`schema.ts`/`render.ts`), and human date-range parsing (`time/ranges.ts`). **Out:** any actual command logic (auth flow → `auth-identity`; review → `review`; reads/writes → later plans). Commands are registered as stubs that throw `NOT_IMPLEMENTED` with a pointer to their plan.

## Implements

- `specs/architecture.md` — full project structure, build, config dir, env overrides, hooks toggle.
- `specs/api/conventions.md` — base URL, the three auth headers, the error→AxiError mapping table, pagination shape.
- `specs/api/time-entries.md` — only the **client-level** concerns (the generic list/get/post/patch/delete plumbing); per-command shaping is later.
- `specs/behaviors/date-ranges.md` — `time/ranges.ts`: parse `--from/--to`, `--since <dur>`, named windows; emit `{ from, to, label }`.

## Approach

1. `bin/harvest-axi.ts` → `src/cli.ts main()` calling `runAxiCli({ description, version, topLevelHelp, home, commands, hooks })`. Mirror gws-axi's `cli.ts` (version read from package.json, `HARVEST_AXI_DISABLE_HOOKS` honored).
2. `src/config.ts` — config dir resolution (`XDG_CONFIG_HOME` → `~/.config/harvest-axi`), read/write `config.json`, env-override precedence (`HARVEST_ACCESS_TOKEN`/`HARVEST_ACCOUNT_ID`), `resolveCredentials()` returning `{ token, accountId }` or null.
3. `src/harvest/client.ts` — `harvestRequest(path, { method, query, body })` using `fetch`, injecting the three headers (User-Agent `harvest-axi (<repo url>)`), JSON in/out, and a `translateHarvestError(res)` that maps 401/403/404/422/429/5xx → `AxiError` per the conventions table (no raw body leakage; honor `Retry-After`).
4. `src/harvest/paginate.ts` — `paginateAll(path, query)` that follows `links.next` to completion, returns `{ items, total_entries, complete }`.
5. `src/output/{schema,render,index}.ts` — port `FieldDef`/`field`/`pluck`/`mapEnum`/`truncated`/`computed` + `renderList`/`renderListResponse`/`renderObject`/`renderHelp`/`joinBlocks` from gws-axi (proven; not reinvented).
6. `src/time/ranges.ts` — `parseRange(flags, { defaultSince })` → `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label }`; unparseable → `AxiError VALIDATION_ERROR` listing accepted forms.

## Validation

- [ ] `bun run build` compiles clean; `dist/bin/harvest-axi.js` is executable.
- [ ] `harvest-axi` (no args) prints bin + description home header (stub data ok).
- [ ] `harvest-axi --help` and `-v` work via the SDK fast paths.
- [ ] `harvestRequest` injects all three headers; a 401 surfaces `TOKEN_INVALID` with the `auth setup` suggestion and no raw body.
- [ ] `paginateAll` fetches every page of a >2000-row fixture and reports `complete: true` with the right `total_entries`.
- [ ] `parseRange` unit tests: `--since 7d`, `--this-week`, `--from/--to`, named windows, and a bad input → `VALIDATION_ERROR`. Stamped `label` includes the explicit year.
- [ ] Output helpers have parity tests with the expected TOON shapes.

## Risks / unknowns

- **User-Agent contact string** — Harvest requires a real app name + contact; use the repo URL. Low risk.
- **Week start preference** — accounts can start weeks on Sunday; default Monday and revisit if the live account differs (note in date-ranges spec if so).

## Notes

## Follow-ups
