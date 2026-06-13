---
status: done
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

- [x] `invoices` lists against the live account with a totals + by-state header (counts per state, summed `$ amount`/`$ due`, currency), `complete: true`, newest-first rows. _(live: 1504 invoices — draft 3/open 7/paid 1447/closed 47, $24.4M amount / $518.8k due, complete:true; unit-tested rollup + newest-first)_
- [x] `invoices --drafts` (and `--state open|paid|closed`) filter correctly; `--client <name>`/`--project <name>` resolve via the browse cache and filter server-side. _(live: --drafts → 3; --client "Mobility Data" → 23 with client name resolved; unit: state=draft + client_id=1 carried on the query)_
- [x] Date windows filter on `issue_date` (`--from/--to`, named windows) and `--since` maps to `updated_since`; the resolved range is stamped in the header. _(live: --last-month → "2026-05-01 → 2026-05-31 (last-month)", 4 invoices)_
- [x] `invoices get <id>` shows all four field groups + line items + payments + messages, with the composed public `web`/`pdf` links; `--raw` dumps untranslated JSON. _(live: draft 52478541 full detail w/ jarvus.harvestapp.com links; paid 52170740 folded in a $20,700.90 payment + email/view messages; unit: all blocks + --raw single-fetch)_
- [x] Empty list → definitive empty state with broaden/scope hints; `--limit` cap announced (`Showing N of M…`), never silent. _(live: closed×Mobility Data → "0 invoices found"; --limit 8 → "Showing 8 of 1504"; unit both)_
- [x] A non-manager token (or simulated `403`) yields a translated `FORBIDDEN` referencing the role requirement — no raw API noise. _(unit: 403 → code FORBIDDEN; live account is a manager so the gate doesn't fire)_

## Risks / unknowns

- **Account subdomain for public URLs** — `client_key` needs the company subdomain to build the web/pdf link. Confirm it's in the profile cache (from `auth setup` / `/v2/company`); if absent, cache it on first `get` or note the link as unavailable rather than guessing.
- **Manager-gated dogfooding** — the live account token (192183) is a manager, so reads work; the non-manager path is validated by simulating `403` translation in a unit test, not live.
- **Mixed currencies in the list total** — follow the `reports` resolution: >1 distinct currency → header shows `(mixed currencies — not summed)`.

## Notes

- **Profile cache extended with `base_uri`** (`config.ts` + `identity.ts`): `/v2/company.base_uri` (e.g. `https://jarvus.harvestapp.com`) is now cached at `auth setup`/`whoami`, and `invoices get` composes the public `web`/`pdf` links from it + `client_key`. Pre-existing configs (cached before this change) carry `base_uri: null` — handled gracefully: `get` then emits a `client_key` + "run `whoami --refresh`" note instead of a half-built URL. Refreshed the live config once to populate it.
- **List date filter is opt-in, not defaulted.** Unlike `review` (which always has a window), `invoices` with no date flag queries all dates (header shows `range: all dates`) — matching how you'd actually browse invoices ("show me all the drafts", not "drafts from the last 7 days"). A window only applies when a date flag is present.
- **`--since` → `updated_since`** (not `issue_date`), per the API: "recently changed" is the natural meaning of `--since` for invoices, distinct from the `--from/--to` issue-date window.
- **Messages include `view` events**, not just sends — Harvest logs client opens. The schema renders `event_type` (`(email)` when null = an actual send) so the send/open trail is legible. Verified live on a paid invoice (2 views + 2 emails).
- **`complete` reflects pagination only** — no client-side filtering happens on the list (all filters are server-side), so it's always the honest pagination signal.
- 98 → 99 tests (12 in `invoices.test.ts`, incl. the first `403`→FORBIDDEN coverage in the suite).

## Follow-ups

- `invoices-write` consumes this plan's `resolveEntity` wiring and the read-before-write `GET` path (its draft guard re-fetches the invoice this plan already knows how to read).
