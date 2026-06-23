---
status: done
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

- [x] `invoices create --client <name> --line "kind|price|qty|desc|project"` creates a draft whose line item is linked to the named project; the create summary echoes the line with its project (no `--raw`, no follow-up `get`). _(live: draft 52558054 created with line linked to "API Test", project shown in the create summary; unit: `project_id: 5` in the POST body + echoed line_items block)_
- [x] `invoices edit <draftId> --update-line "<lineId>|||||<project>"` sets the project on an existing line without altering its other fields; the summary confirms the link. _(live: draft 52558084 — created with an **unlinked** line (the #2732 scenario), then `--update-line` added "API Test"; only the project changed, summary echoed it; unit: PATCH body `{id:777, project_id:5}` only)_
- [x] An unknown/ambiguous project token in a line segment fails with a `VALIDATION_ERROR` (candidates listed) **before** any POST/PATCH. _(unit: "fails on an unknown line project before any POST" asserts no POST is made)_
- [x] `--line` with a `|` inside the description (over-segmented) produces a clear `VALIDATION_ERROR`. _(unit: "rejects a --line with a | in the description")_
- [x] `--payment-options ach,credit_card` sets `payment_options` on the draft; an invalid token → `VALIDATION_ERROR`. _(live: `--payment-options ach` confirmed in `invoices get`; unit: array in POST body + "venmo" rejected before any fetch with a numeric client)_
- [x] A syntactically-valid but account-disallowed line project surfaces the Harvest `422` as a translated, actionable error. _(live: re-linking to a non-billable/cross-client project returned the translated "Line items may only be assigned to billable projects for this invoice's client" VALIDATION_ERROR — the 422-translation path exercised end-to-end)_
- [x] Create/edit result summaries render the `line_items` block with the `project` column for every line. _(live both create & edit; the `line_items[N]{id,kind,description,project,quantity,unit_price,amount}` block)_
- [x] No regression to the draft-only guard or the no-send/no-pay boundary. _(139 tests pass, incl. the 3 boundary assertions and both guard refusals; +6 new tests)_

## Risks / unknowns

- **Pipe-in-description ambiguity** — positional `project` segment means a literal `|` in a description breaks parsing. Accepted trade-off (positional chosen over a separate `--line-project` flag for one-flag-per-line clarity); mitigated by a max-segment guard that errors loudly. If descriptions with pipes become a real need, revisit with an escape or a separate flag.
- **`payment_options` enablement is account-dependent** — setting an option not configured on the account 422s. We validate the _vocabulary_ client-side but cannot know what's enabled; rely on the translated 422. (The originating session also noted payment options are often (re)applied at finalize in the Harvest UI — so this flag's value is partly belt-and-suspenders.)
- **Async parsing refactor** — moving project resolution ahead of the mutation must preserve the existing fail-fast ordering (client resolved first, then projects) and not double-resolve; keep resolution in one batched pass.

## Notes

- **Async line parsing refactor:** `parseLineItem`/`parseUpdateLine` now return `ParsedLine` (`{item, project?}`) — syntax parsing stays synchronous/fail-fast, and a single batched `resolveLineProjects` resolves unique project tokens in parallel **after** client resolution but **before** the POST/PATCH. `--remove-line` validation is parsed before that resolve so a bad remove id still fails fast.
- **Project must belong to the invoice's client.** Harvest enforces "line items may only be assigned to billable projects for this invoice's client" — a line can't be linked to a project under a different client (nor a non-billable one). Confirmed live: linking a Jarvus invoice's line to a SEPTA project 422s. harvest-axi surfaces this as a translated `VALIDATION_ERROR`; it does not (and shouldn't) pre-validate the client↔project pairing client-side — the API is the authority.
- **Pipe-in-description is unsupported by design** — the trailing `<project>` segment is positional-last, so >5 (`--line`) / >6 (`--update-line`) segments error loudly rather than silently mis-parsing a desc fragment as the project. Chosen over a separate `--line-project` flag to preserve one-flag-per-line.
- **`payment_options` vocabulary is validated client-side** (`ach,credit_card,paypal`); enablement is account-dependent and left to the API (translated 422). The originating session noted payment options are often (re)applied at finalize in the Harvest UI, so this flag is partly belt-and-suspenders.
- 133 → 139 tests (+6: line project resolve+echo, unknown-project fail-fast, over-segmented `--line`, `--payment-options` set + invalid-token reject, `--update-line` project-only edit).

## Follow-ups

- `taxed`/`taxed2` per-line flags remain documented in `specs/api/invoices.md` line-item params but unexposed by the CLI (deliberately out of this plan's scope). **Tracked as:** a possible future plan if per-line tax control is ever needed; no demand yet.
- A `--copy-from <id>` / clone-to-draft "next invoice in a series" create mode was considered (it would have made the originating session a one-liner) and deliberately deferred. **Tracked as:** revisit if building consistent follow-on invoices in a PO series becomes a recurring need.
