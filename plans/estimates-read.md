---
status: planned
depends: [auth-identity, browse]
specs:
  - specs/api/estimates.md
  - specs/commands/estimates.md
issues: []
---

# Plan: Estimates — read surface (list + detail)

## Scope

**In:** `estimates [filters]` (list/review, paginated, totals + by-state header) and `estimates get <id>` (full detail folding in the messages sub-resource). Manager-gated reads over `GET /v2/estimates`, `/v2/estimates/{id}`, `/v2/estimates/{id}/messages`. **Out:** all estimate mutation — that's [`estimates-write`](estimates-write.md), which depends on this plan's read + name-resolution path. Also out (no such endpoint): a payments sub-resource.

This command is built by **mirroring [`invoices`](../specs/commands/invoices.md)** (self-contained `estimates.ts`, per the chosen approach), trimmed to the estimates subset — see [api/estimates § the subset boundary](../specs/api/estimates.md#how-estimates-differ-from-invoices-the-subset-boundary).

## Implements

- `specs/api/estimates.md` — the LIST + RETRIEVE endpoints, the field inventory (4 groups, no money-balance/period/refs), the `client_key`→public-URL composition, the messages read sub-resource. (Write endpoints are specced here but implemented in `estimates-write`.)
- `specs/commands/estimates.md` — the two read subcommands, their schemas, the totals/by-state header (`draft/sent/accepted/declined`), the stacked-block detail view, `--drafts`, `--raw`, name resolution via `browse`.

## Approach

1. `src/commands/estimates.ts` — mirror `src/commands/invoices.ts` structure: dispatch `list` (default) vs `get <id>`, per-command `--help`, the same `num`/`money2`/`nestedName` local helpers. Self-contained copy (no shared-module extraction — decided up front).
2. **List:** parse `--state`/`--drafts` (vocab `draft|sent|accepted|declined`), `--client` (→ `resolveEntity`, before any fetch — **drop `--project`**, no API filter), date window via `parseRange` (`issue_date` `from`/`to`; `--since` → `updated_since`). `paginateAll("estimates", "estimates", query)`. Local rollup: count per state + sum `amount`, capture `currency` (mixed → not summed). Structured header (`{range,scope,total,draft,sent,accepted,declined,amount,currency,complete}`) + `estimates[N]{id,number,client,state,amount,issue_date}` sorted newest-first; definitive empty state; `--limit` cap announced loudly.
3. **Get:** two reads — estimate (`GET /v2/estimates/{id}`) + `paginateAll` messages (**no payments read**). Compose the stacked blocks (`estimate`/`money`/`lifecycle`/`links`/`line_items`/`messages` — **no `references` block**). `money` drops `due_amount`; `lifecycle` is `sent_at/accepted_at/declined_at`; `line_items` drops the `project` column. `links` from `client_key` + `base_uri` → `/client/estimates/{client_key}`(`.pdf`). `--raw` short-circuits to untranslated JSON.
4. Wire `estimates` into the CLI: add to `commands`/`getCommandHelp` maps in `cli.ts`, bump `commands[9]`→`[10]` in `TOP_HELP`, add an example line. Surface on home/help where it fits (manager-only — degrade quietly for non-managers).
5. Reuse the shared client's `403`→`FORBIDDEN` translation; confirm the role-gate message references the manager requirement.

## Validation

- [ ] `estimates` lists against the live account with a totals + by-state header (counts per `draft/sent/accepted/declined`, summed `$ amount`, currency), `complete: true`, newest-first rows.
- [ ] `estimates --drafts` (and `--state sent|accepted|declined`) filter correctly; `--client <name>` resolves via the browse cache and filters server-side.
- [ ] Date windows filter on `issue_date` (`--from/--to`, named windows) and `--since` maps to `updated_since`; the resolved range is stamped in the header.
- [ ] `estimates get <id>` shows all field groups + line items + messages, with the composed public `web`/`pdf` (`/client/estimates/...`) links; `--raw` dumps untranslated JSON. No `payments` or `references` block is emitted, and no `project` column appears on line items.
- [ ] Empty list → definitive empty state with broaden/scope hints; `--limit` cap announced (`Showing N of M…`), never silent.
- [ ] A non-manager token (or simulated `403`) yields a translated `FORBIDDEN` referencing the role requirement — no raw API noise.

## Risks / unknowns

- **Live data volume** — the account may have far fewer estimates than invoices (1504); confirm the rollup/empty-state both exercise. If zero estimates exist live, validate the rollup with a unit test and the create path (in `estimates-write`) as the first live row.
- **`client_key` on estimates** — confirm the public URL path is `/client/estimates/{client_key}` (not `/invoices/`) and that estimates expose `client_key` like invoices do; verify on the first live `get`.
- **Mixed currencies in the list total** — follow the invoices/reports resolution: >1 distinct currency → header shows `(mixed currencies — not summed)`.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
