---
status: planned
depends: [browse-detail]
specs:
  - specs/api/reference-data.md
  - specs/commands/browse.md
issues: []
---

# Plan: Browse — client contacts

## Scope

**In:** `browse contacts [--client <id|name>]` list, `browse contacts <id>` detail, and **folding a client's contacts into `browse clients <id>`** (the invoice-recipient view alongside the client). **Out:** contact create/update/delete (read-only, like the rest of reference data).

## Implements

- `specs/api/reference-data.md` (Client Contacts) — `GET /v2/contacts` (+ `client_id` filter), `GET /v2/contacts/{id}`, the contact object.
- `specs/commands/browse.md` — the `contacts` list subcommand, the contact detail view, and the client-detail fold-in.

## Approach

1. Add `contacts` to `browse.ts` dispatch: list (with `--client` → `client_id`, resolved via the cache) vs detail (trailing numeric positional → `GET /v2/contacts/{id}`).
2. List schema `contacts[N]{id,name,client,email,phone}` (name = first+last; phone prefers office then mobile). Detail renders `id · name · title · client · email · phone_office · phone_mobile · invoice_recipient_status`.
3. **Client detail fold-in:** in `clientDetail`, after the client GET, `paginateAll("contacts", "contacts", { client_id: id })` and append a `contacts[N]{name,title,email,phone}` block. Mirrors how `projectDetail` folds in task assignments.
4. Contacts are **id-keyed only** (no name resolution/cache) — `browse contacts <id>` takes a numeric id; a non-numeric arg → `VALIDATION_ERROR` pointing at `browse contacts --client <name>` to find ids.

## Validation

- [ ] `browse contacts` lists contacts `{id,name,client,email,phone}`, paginated to completion; `--client <id|name>` filters via resolved `client_id`.
- [ ] `browse contacts <id>` shows the full contact record incl. `invoice_recipient_status`; a non-numeric arg → actionable `VALIDATION_ERROR`; a bad id → `NOT_FOUND`.
- [ ] `browse clients <id|name>` folds in that client's contacts as a `contacts[...]` block (empty → omitted or a clear "no contacts" line).
- [ ] Definitive empty state when a client has no contacts; manager-gating `403` translates (shared client path).

## Risks / unknowns

- **No per-client nested route** — must use `GET /v2/contacts?client_id=`; confirmed in the API spec. The fold-in is a second paginated call on client detail (one extra round-trip, same pattern as project task assignments).
- **Contacts aren't in the resolver** — deliberately id-keyed (names are person names, not unique handles); keep it simple rather than add a fifth cache.

## Notes

_(to be filled at closeout)_

## Follow-ups

- Contact writes (create/update/delete) are out of scope; revisit only if an invoice-recipient-management workflow is wanted (would pair with the held invoice-send surface).
