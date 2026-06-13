---
status: planned
depends: [auth-identity, browse]
specs:
  - specs/api/invoices.md
  - specs/commands/invoices.md
issues: []
---

# Plan: Invoices — read surface (list + detail)

## Scope

**In:** `invoices [filters]` (list/review, paginated, totals + by-state header) and `invoices get <id>` (full detail folding in payments + messages). Manager-gated reads over `GET /v2/invoices`, `/v2/invoices/{id}`, `/v2/invoices/{id}/payments`, `/v2/invoices/{id}/messages`. **Out:** all invoice mutation — that's [`invoices-write`](invoices-write.md), which depends on this plan's read + name-resolution path.

## Implements

- `specs/api/invoices.md` — the LIST + RETRIEVE endpoints, the field inventory (4 groups), the `client_key`→public-URL composition, the payments/messages read sub-resources. (Write endpoints are specced here but implemented in `invoices-write`.)
- `specs/commands/invoices.md` — the two read subcommands, their schemas, the totals/by-state header, the stacked-block detail view, `--drafts`, `--raw`, name resolution via `browse`.

## Approach

1. `src/commands/invoices.ts` — dispatch `list` (default, no subcommand) vs `get <id>`. Per-command `--help`.
2. **List:** parse `--state`/`--drafts`, `--client`/`--project` (→ `resolveEntity`, before any fetch), date window via `parseRange` (`issue_date` `from`/`to`; `--since` → `updated_since`). `paginateAll("invoices", "invoices", query)`. Local rollup: count per state + sum `amount`/`due_amount`, capture `currency` (mixed → not summed, per the reports precedent). Structured header + `invoices[N]{id,number,client,state,amount,due,issue_date,due_date}` sorted newest-first; definitive empty state; `--limit` cap announced loudly.
3. **Get:** three reads — invoice (`GET /v2/invoices/{id}`), `paginateAll` payments, `paginateAll` messages. Compose the stacked blocks (`invoice`/`money`/`lifecycle`/`links`/`references`/`line_items`/`payments`/`messages`). `links` from `client_key` + the account subdomain (from the profile cache). `--raw` short-circuits to the untranslated invoice JSON.
4. Wire `invoices` into the CLI (replace any stub); add to home/help surfaces where invoices fit (manager-only — degrade quietly for non-managers).
5. Reuse the shared client's `403`→`FORBIDDEN` translation; confirm the role-gate message references the manager requirement.

## Validation

- [ ] `invoices` lists against the live account with a totals + by-state header (counts per state, summed `$ amount`/`$ due`, currency), `complete: true`, newest-first rows.
- [ ] `invoices --drafts` (and `--state open|paid|closed`) filter correctly; `--client <name>`/`--project <name>` resolve via the browse cache and filter server-side.
- [ ] Date windows filter on `issue_date` (`--from/--to`, named windows) and `--since` maps to `updated_since`; the resolved range is stamped in the header.
- [ ] `invoices get <id>` shows all four field groups + line items + payments + messages, with the composed public `web`/`pdf` links; `--raw` dumps untranslated JSON.
- [ ] Empty list → definitive empty state with broaden/scope hints; `--limit` cap announced (`Showing N of M…`), never silent.
- [ ] A non-manager token (or simulated `403`) yields a translated `FORBIDDEN` referencing the role requirement — no raw API noise.

## Risks / unknowns

- **Account subdomain for public URLs** — `client_key` needs the company subdomain to build the web/pdf link. Confirm it's in the profile cache (from `auth setup` / `/v2/company`); if absent, cache it on first `get` or note the link as unavailable rather than guessing.
- **Manager-gated dogfooding** — the live account token (192183) is a manager, so reads work; the non-manager path is validated by simulating `403` translation in a unit test, not live.
- **Mixed currencies in the list total** — follow the `reports` resolution: >1 distinct currency → header shows `(mixed currencies — not summed)`.

## Notes

_(to be filled at closeout)_

## Follow-ups

- `invoices-write` consumes this plan's `resolveEntity` wiring and the read-before-write `GET` path (its draft guard re-fetches the invoice this plan already knows how to read).
