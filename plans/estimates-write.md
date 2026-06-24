---
status: planned
depends: [estimates-read]
specs:
  - specs/api/estimates.md
  - specs/commands/estimates.md
issues: []
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

- [ ] `estimates create --client <name> --line ...` creates a **draft** and returns its id + line-item summary; `estimates get <id>` shows it.
- [ ] `--line` parses four segments (`kind|unit_price|qty|desc`); a 5-segment spec (a stray trailing project) errors loudly rather than silently mis-parsing — there is no project token on estimate lines.
- [ ] `estimates edit <id>` on a **draft** PATCHes only supplied fields; a line-item add / edit / remove each take effect; an edit with no changes errors.
- [ ] `estimates edit <id>` / `delete <id>` on a **non-draft** (sent/accepted/declined) fail with a `VALIDATION_ERROR` and perform **no** mutation (guard fires before the network call).
- [ ] `estimates delete <id>` on a draft deletes it; a second delete (absent id) is a no-op exit 0.
- [ ] Self-cleaning live cycle: create a draft → edit it → delete it, leaving nothing on the real account.
- [ ] No code path can send, mark-as-sent, accept, decline, or re-open — verified by the absence of those endpoints + a test asserting the message POST paths are never constructed (mirrors the invoices boundary test).

## Risks / unknowns

- **Guard is advisory** — drafts-only is enforced only within harvest-axi; documented honestly in the spec so no one mistakes it for an account lock.
- **Non-draft fixture for the guard test** — needs a sent/accepted estimate to point `edit`/`delete` at (read-only) for the live refusal check; if the account has none, simulate the non-draft `state` in a unit test (as invoices did for some paths).
- **Line-item flag parity** — reuse the exact `--line`/`--update-line`/`--remove-line` shape settled in `invoices-write`, minus the trailing project segment, so the two commands stay muscle-memory-compatible for agents.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
