---
status: done
depends: [estimates-read]
specs:
  - specs/api/estimates.md
  - specs/commands/estimates.md
issues: []
pr: 10
---

# Plan: Estimates — draft workbench (create / edit / delete)

## Scope

**In:** `estimates create` (free-form lines only), `estimates edit <id>`, `estimates delete <id>` — every operation confined to **`draft`** estimates. **Out (deliberate, recorded in the spec's [write boundary](../api/estimates.md#write-boundary--out-of-scope-deliberate-recorded)):** sending/emailing, mark-as-sent (`event_type: send`), accept/decline/re-open, deleting messages. This is a **pure draft workbench** — the agent never transitions an estimate out of `draft`.

Built by mirroring [`invoices-write`](invoices-write.md), trimmed to the estimates subset: **no `--from-tracked` import path, no line-item `project` token, no payment-term/options/due-date flags, and no `payment_options` preservation step** (none of those fields exist on an estimate).

## Implements

- `specs/commands/estimates.md` — the three write subcommands, the free-form create mode, the line-item add/edit/`_destroy` operations on `edit`, and the **draft-only guard**.
- `specs/api/estimates.md` — `POST /v2/estimates` (free-form `line_items` only), `PATCH /v2/estimates/{id}`, `DELETE /v2/estimates/{id}`. The messages **write** endpoints stay unimplemented by design.

## Approach

1. Extend `src/commands/estimates.ts` with `create` / `edit` / `delete` dispatch (reads already present from `estimates-read`), mirroring the invoices write helpers.
2. **Draft-only guard** — a `requireDraft(id)` helper does a `GET /v2/estimates/{id}` and throws `VALIDATION_ERROR` unless `state === "draft"`, **before** any mutating call, returning the fetched estimate so `edit`/`delete` don't double-GET. `NOT_FOUND` is caught in `delete` (→ idempotent no-op) but propagates in `edit`.
3. **create:** require `--client` (→ `resolveEntity` first); build `line_items[]` from repeatable `--line "<kind>|<unit_price>|<quantity>|<description>"` (**four segments, no project token** → `parseLineItem` max-4, no `resolveLineProjects`); pass through `--subject/--notes/--issue-date/--tax/--tax2/--discount/--po/--currency`. `POST`; return created draft id + line-item summary + an `estimates get <id>` suggestion. **No `--from-tracked` branch.**
4. **edit:** `requireDraft`, then PATCH only supplied top-level fields + line-item ops (add via `--line` = no id, edit via `--update-line "<id>|<kind>|<unit_price>|<quantity>|<description>"` blank=keep, remove via `--remove-line` = `{id,_destroy:true}`). **No `payment_options` re-send** — estimates have no such field; every field is honest partial-update. Error if no field/line change supplied.
5. **delete:** `requireDraft` (absent id → no-op exit 0 per idempotency), then `DELETE`.
6. 422 (bad line item, client mismatch) → `VALIDATION_ERROR` surfacing the rejected field; reuse the shared translation.

## Validation

- [x] `estimates create --client <name> --line ...` creates a **draft** and returns its id + line-item summary; `estimates get <id>` shows it. _(live: created draft 4061950 on BRDG with a $1 line; unit: client_id resolved + `line_items` body + POST targets `/estimates`)_
- [x] `--line` parses four segments (`kind|unit_price|qty|desc`); a 5-segment spec (a stray trailing project) errors loudly rather than silently mis-parsing — there is no project token on estimate lines. _(unit: `Service|200|10|Phase 1|GTFS` → "too many … segments")_
- [x] `estimates edit <id>` on a **draft** PATCHes only supplied fields; a line-item add / edit / remove each take effect; an edit with no changes errors. _(live: edited 4061950 — notes + a second --line took it 1→2 items, amount 1→7; unit: PATCH body carries notes + line add + `{id,_destroy:true}`, `--update-line` blank-segment keep, empty-edit rejected)_
- [x] `estimates edit <id>` / `delete <id>` on a **non-draft** (sent/accepted/declined) fail with a `VALIDATION_ERROR` and perform **no** mutation (guard fires before the network call). _(live: edit refused accepted estimate 3675829 read-only; unit: both refuse the accepted fixture with no PATCH/DELETE)_
- [x] `estimates delete <id>` on a draft deletes it; a second delete (absent id) is a no-op exit 0. _(live: deleted 4061950, second delete → no-op, drafts back to 6; unit both)_
- [x] Self-cleaning live cycle: create a draft → edit it → delete it, leaving nothing on the real account. _(done end-to-end live; net zero — draft count returned to 6)_
- [x] No code path can send, mark-as-sent, accept, decline, or re-open — verified by the absence of those endpoints + a test asserting the message POST paths are never constructed (mirrors the invoices boundary test). _(3 boundary tests: no `event_type:` write literal, `/messages` only via `paginateAll` GET, no `/payments` reference at all)_

## Risks / unknowns

- **Guard is advisory** — drafts-only is enforced only within harvest-axi; documented honestly in the spec so no one mistakes it for an account lock.
- **Non-draft fixture for the guard test** — needs a sent/accepted estimate to point `edit`/`delete` at (read-only) for the live refusal check; if the account has none, simulate the non-draft `state` in a unit test (as invoices did for some paths).
- **Line-item flag parity** — reuse the exact `--line`/`--update-line`/`--remove-line` shape settled in `invoices-write`, minus the trailing project segment, so the two commands stay muscle-memory-compatible for agents.

## Notes

- **Simpler than `invoices-write` by exactly the subset trims**: no `--from-tracked`/`line_items_import`, no line-item `project` token (so `parseLineItem` is max-4, no `resolveLineProjects`), no `--payment-term`/`--due-date`/`--payment-options`, and critically **no `payment_options` preservation step** — the gnarliest part of `invoices edit` (issue #9) simply doesn't exist here, since estimates have no such field. `edit` is therefore a plain partial-update PATCH.
- **Draft guard returns the fetched estimate** so it mirrors the invoices guard contract, though estimates `edit`/`delete` don't currently need the returned body (no payment_options to re-send). Kept the return for parity and future-proofing. NOT_FOUND is caught in `delete` (→ idempotent no-op) but propagates in `edit`.
- **Boundary enforced by tests, not just convention** — `estimates.test.ts` greps the source: no `event_type:` write literal, `/messages` only inside `paginateAll` (GET), and **no `/payments` reference at all** (estimates have no payments sub-resource). A future edit wiring send/accept/decline would fail the suite.
- **Dogfooded live, net-zero**: create 4061950 → edit (1→2 lines) → delete → idempotent re-delete, leaving the account's draft count back at 6; the non-draft guard was confirmed read-only against accepted estimate 3675829.
- 156 → 170 tests (+14: create require-client/free-form/require-line/over-segmented, edit line-ops + update-line + empty-edit + non-draft refusal, delete + non-draft refusal + no-op, 3 boundary assertions).

## Net result

`harvest-axi estimates` is now a complete read + **draft-workbench** surface mirroring `invoices`, trimmed to the estimates subset — review/list, full detail, and create/edit/delete confined to drafts, with the no-send/no-transition boundary mechanically enforced.

## Follow-ups

- If a send / accept / decline workflow is ever wanted, it would be a **separate, explicitly-opted-in** plan with hard confirmation gates — not folded into this workbench (same stance as `invoices-write`).
