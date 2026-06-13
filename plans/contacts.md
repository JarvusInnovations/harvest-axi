---
status: done
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

- [x] `browse contacts` lists contacts `{id,name,client,email,phone}`, paginated to completion; `--client <id|name>` filters via resolved `client_id`. _(live: --client "Jarvus Innovations" → 0 (scope echoed); unit: client_id=5 on the query + schema)_
- [x] `browse contacts <id>` shows the full contact record incl. `invoice_recipient_status`; a non-numeric arg → actionable `VALIDATION_ERROR`; a bad id → `NOT_FOUND`. _(live: contact 12468284 → recipient status; non-numeric "John" → exit 2 no fetch; unit both + NOT_FOUND via shared client path)_
- [x] `browse clients <id|name>` folds in that client's contacts as a `contacts[...]` block (empty → omitted or a clear "no contacts" line). _(live: "Sound Transit" → 4 contacts incl. Accounts Payable; unit: fold-in block)_
- [x] Definitive empty state when a client has no contacts; manager-gating `403` translates (shared client path). _(live empty + unit "no contacts on this client"; 403 is the shared translation, unit-tested in invoices.test)_

## Risks / unknowns

- **No per-client nested route** — must use `GET /v2/contacts?client_id=`; confirmed in the API spec. The fold-in is a second paginated call on client detail (one extra round-trip, same pattern as project task assignments).
- **Contacts aren't in the resolver** — deliberately id-keyed (names are person names, not unique handles); keep it simple rather than add a fifth cache.

## Notes

- **Contacts are id-keyed, not name-resolved** (kept out of the resolver — person names aren't unique handles). `browse contacts <id>` requires a numeric id; a non-numeric arg fails fast with a hint to `browse contacts --client "<name>"` to find ids.
- **Client detail fold-in adds a second fetch** (`contacts?client_id=`), mirroring the project→task-assignments pattern. Empty → a `contacts: no contacts on this client` line rather than a silent omission. This changed `clientDetail`'s fetch count, so the existing client-detail unit test was updated to mock the second call.
- **Phone column prefers office, falls back to mobile** in the list view; detail shows both.
- Live "Sound Transit" has 4 contacts incl. an Accounts Payable entry with `invoice_recipient_status: recipient` — exactly the invoice-recipient context this surfaces.
- +5 tests (browse suite 16 total).

## Follow-ups

- Contact writes (create/update/delete) are out of scope; revisit only if an invoice-recipient-management workflow is wanted (would pair with the held invoice-send surface).
