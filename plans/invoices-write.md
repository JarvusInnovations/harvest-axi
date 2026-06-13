---
status: planned
depends: [invoices-read]
specs:
  - specs/api/invoices.md
  - specs/commands/invoices.md
issues: []
---

# Plan: Invoices — draft workbench (create / edit / delete)

## Scope

**In:** `invoices create` (free-form **and** `--from-tracked` time/expenses import), `invoices edit <id>`, `invoices delete <id>` — every operation confined to **`draft`** invoices. **Out (deliberate, recorded in the spec's [write boundary](../api/invoices.md#write-boundary--out-of-scope-deliberate-recorded)):** sending/emailing, mark-as-sent (`event_type: send`), close/re-open/mark-draft, recording or deleting payments, deleting messages. This is a **pure draft workbench** — the agent never transitions an invoice out of `draft`.

## Implements

- `specs/commands/invoices.md` — the three write subcommands, the free-form vs `--from-tracked` create modes, the line-item add/edit/`_destroy` operations on `edit`, and the **draft-only guard**.
- `specs/api/invoices.md` — `POST /v2/invoices` (both `line_items` and `line_items_import` shapes), `PATCH /v2/invoices/{id}`, `DELETE /v2/invoices/{id}`. The messages/payments **write** endpoints stay unimplemented by design.

## Approach

1. Extend `src/commands/invoices.ts` with `create` / `edit` / `delete` dispatch (reads already present from `invoices-read`).
2. **Draft-only guard** — a shared `requireDraft(id)` helper does a `GET /v2/invoices/{id}` and throws `VALIDATION_ERROR` unless `state === "draft"`, **before** any mutating call. `edit` and `delete` both gate through it. (Client-side convention — the API does not enforce it; documented as such.)
3. **create (free-form):** require `--client` (→ `resolveEntity` first); build `line_items[]` from repeatable line flags; pass through `--subject/--notes/--issue-date/--due-date/--payment-term/--tax/--discount/--po`. `due_date` custom ⇒ force `payment_term: custom` (or error if conflicting). `POST`; return created draft id + summary + an `invoices get <id>` suggestion.
4. **create (`--from-tracked`):** require ≥1 `--project` (→ `project_ids`); build `line_items_import.time` with `--summary` (default `project`) + optional paired `--from/--to`; optional `--expenses` block. `POST`. This is the tracked-time → draft bridge.
5. **edit:** `requireDraft`, then PATCH only supplied top-level fields + line-item ops (add = no id, edit = id + fields, remove = `{id,_destroy:true}`).
6. **delete:** `requireDraft` (absent id → no-op exit 0 per idempotency), then `DELETE`.
7. 422 (bad line item, client/project mismatch) → `VALIDATION_ERROR` surfacing the rejected field; reuse the shared translation.

## Validation

- [ ] `invoices create --client <name> --line ...` creates a **draft** and returns its id + summary; `invoices get <id>` shows it.
- [ ] `invoices create --from-tracked --project <name> --summary project [--from/--to]` builds a draft from tracked time (line items present); omitting the window imports unbilled entries.
- [ ] `invoices edit <id>` on a **draft** PATCHes only supplied fields; a line-item add / edit / remove each take effect.
- [ ] `invoices edit <id>` / `delete <id>` on a **non-draft** (open/paid/closed) fail with a `VALIDATION_ERROR` and perform **no** mutation (guard fires before the network call).
- [ ] `invoices delete <id>` on a draft deletes it; a second delete (absent id) is a no-op exit 0.
- [ ] Self-cleaning live cycle: create a draft → edit it → delete it, leaving nothing on the real account; the non-draft guard verified by pointing `edit`/`delete` at an existing open/paid invoice (read-only — confirms refusal without mutating).
- [ ] No code path can send, mark-as-sent, close, re-open, or record a payment — verified by the absence of those endpoints + a test asserting the message/payment POST paths are never constructed.

## Risks / unknowns

- **Line-item flag ergonomics** — the create surface needs a line-item syntax that's agent-friendly without being fiddly. Settle the exact shape (`--line "kind|unit_price|qty|desc"` vs repeatable typed flags) during build; spec leaves it open.
- **Guard is advisory** — drafts-only is enforced only within harvest-axi; documented honestly in the spec so no one mistakes it for an account lock.
- **`--from-tracked` double-billing** — importing unbilled time twice would create duplicate drafts; mitigated by the natural `unbilled`-only default and surfacing the imported line count so the agent can verify before finalizing (finalize itself is out of scope).

## Notes

_(to be filled at closeout)_

## Follow-ups

- If a finalize/send workflow is ever wanted, it would be a **separate, explicitly-opted-in** plan with hard confirmation gates — not folded into this workbench.
