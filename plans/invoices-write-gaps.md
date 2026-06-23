---
status: in-progress
depends: [invoices-write]
specs:
  - specs/commands/invoices.md
  - specs/api/invoices.md
issues: []
---

# Plan: Invoices — close write-surface gaps (line-item project link, payment options, line echo)

## Scope

**In:** three gaps the draft workbench documented in the API spec but never wired into the CLI surface, all surfaced live while building a Milestone-3 invoice consistent with a paid M1/M2 series:

1. **Line-item project linking** — an optional trailing `<project>` segment on `--line` and `--update-line` (`kind|unit_price|qty|desc|project`), `id|name` resolved via the browse cache, mapping to `project_id` per line item. Closes the gap that forced a raw `PATCH api.harvestapp.com/.../invoices/{id}` to link a line to a project.
2. **`--payment-options`** — a top-level create/edit flag accepting a comma-separated subset of `ach,credit_card,paypal`.
3. **Write-summary line echo** — `create`/`edit` result summaries echo the resulting line items **with their project link**, so the linkage is confirmable without a follow-up `get` (and `--raw` is never needed to check it).

**Out:** `taxed`/`taxed2` per-line flags (documented in `api/invoices.md` line-item params but not requested — left as a possible follow-up); any change to the no-send/no-pay [write boundary](../api/invoices.md#write-boundary--out-of-scope-deliberate-recorded); a `--copy-from`/clone "next-in-series" create mode (considered, deliberately deferred — see Follow-ups).

## Implements

- `specs/commands/invoices.md` — the optional `<project>` segment on `--line`/`--update-line`, the `--payment-options` flag, and the requirement that create/edit summaries echo line items with their project link.
- `specs/api/invoices.md` — already documents `project_id` (opt) and `taxed`/`taxed2` on line items and `payment_options` as a top-level create param; this plan brings the CLI into conformance with that contract (no API-spec change needed).

## Approach

1. **Line-item project segment.** `parseLineItem` / `parseUpdateLine` currently return the body object synchronously. Project resolution is async (`resolveEntity("project", token)`) and must run **before any mutation** (fail fast, consistent with `--client`/`--from-tracked`). Refactor so parsing captures the raw project token into an intermediate spec, then resolve all tokens in one pass (`Promise.all`) and stamp `project_id` onto each line-item body.
   - `--line`: 5 positional segments `kind|unit_price|qty|desc|project`. The 5th is optional; a blank or absent segment ⇒ no `project_id` key.
   - `--update-line`: 6 segments `id|kind|unit_price|qty|desc|project`; blank `project` segment ⇒ leave the existing link unchanged (omit the key), matching the blank-means-keep convention already used for the other update segments.
   - **Pipe-in-description caveat:** because `project` is positional-last, a `|` inside `desc` would be misparsed. This was already true for the prior 4-field form's trailing field; document it (help text + a clear `VALIDATION_ERROR` hint if segment count exceeds the max). Split with an explicit max-segment count so an over-segmented spec errors loudly rather than silently dropping the project.
2. **`--payment-options`.** Add to `WriteFlags` + `parseWriteFlags`; in `buildTopLevel`, split on comma, trim, validate each against `{ach,credit_card,paypal}` (→ `VALIDATION_ERROR` listing valid values), set `body.payment_options = [...]`. A value valid in syntax but not enabled on the account yields a Harvest `422` → reuse the existing translation so the message is actionable.
3. **Write-summary line echo.** Extend `createdSummary` (used by both create and edit) to render a `line_items[N]{kind,description,project,quantity,unit_price,amount}` block (reusing the same column extractors as `invoices get`) instead of only the line count. `project` extracts via the existing `nestedName(item,"project")`, showing the link the create/edit just set.
4. **Help text** (`INVOICES_HELP`) updated: the `--line`/`--update-line` syntax gains the `|<project>` segment, and `--payment-options` is listed under create/edit fields.

## Validation

- [ ] `invoices create --client <name> --line "Service|17000|1|Public Beta (M3)|PA-PERMIT"` creates a draft whose line item is linked to the named project; the create summary echoes the line with its project (no `--raw`, no follow-up `get` needed to confirm).
- [ ] `invoices edit <draftId> --update-line "<lineId>|||||PA-PERMIT"` sets the project on an existing line without altering its other fields; `invoices get <draftId>` confirms the link.
- [ ] An unknown/ambiguous project token in a line segment fails with a `VALIDATION_ERROR` (candidates listed) **before** any POST/PATCH — name resolution runs ahead of mutation.
- [ ] `--line` with a `|` inside the description (over-segmented) produces a clear `VALIDATION_ERROR` rather than silently treating a desc fragment as the project.
- [ ] `invoices create ... --payment-options ach,credit_card` sets `payment_options` on the draft (visible in `invoices get`); an invalid token (e.g. `--payment-options venmo`) → `VALIDATION_ERROR` listing `ach,credit_card,paypal`.
- [ ] A syntactically-valid but account-disabled payment option surfaces the Harvest `422` as a translated, actionable error (not raw API noise).
- [ ] Create/edit result summaries render the `line_items` block with the `project` column for every line.
- [ ] No regression to the draft-only guard or the no-send/no-pay boundary (existing boundary tests still pass).

## Risks / unknowns

- **Pipe-in-description ambiguity** — positional `project` segment means a literal `|` in a description breaks parsing. Accepted trade-off (positional chosen over a separate `--line-project` flag for one-flag-per-line clarity); mitigated by a max-segment guard that errors loudly. If descriptions with pipes become a real need, revisit with an escape or a separate flag.
- **`payment_options` enablement is account-dependent** — setting an option not configured on the account 422s. We validate the *vocabulary* client-side but cannot know what's enabled; rely on the translated 422. (The originating session also noted payment options are often (re)applied at finalize in the Harvest UI — so this flag's value is partly belt-and-suspenders.)
- **Async parsing refactor** — moving project resolution ahead of the mutation must preserve the existing fail-fast ordering (client resolved first, then projects) and not double-resolve; keep resolution in one batched pass.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
