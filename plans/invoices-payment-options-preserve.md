---
status: done
depends: [invoices-write-gaps]
specs:
  - specs/commands/invoices.md
  - specs/api/invoices.md
issues: [9]
---

# Plan: Invoices — preserve payment_options across unrelated edits (fix #9)

## Scope

**In:** fix [#9](https://github.com/JarvusInnovations/harvest-axi/issues/9) — `invoices edit` silently clears a draft's `payment_options` whenever `--payment-options` is omitted. Root cause is a Harvest API quirk (a `PATCH` omitting `payment_options` resets it to `[]`), not the CLI's flag handling — the CLI already omits the field when the flag is absent. Fix: `edit` re-sends the draft's existing `payment_options` (read from the draft-guard `GET`) whenever `--payment-options` is not passed.

**Out:** any other field — audited live: `tax`/`tax2`/`discount`/`currency` and line items all survive an unrelated edit; `payment_options` is the sole exception, so the fix is scoped to it. No change to `create` (a fresh draft has nothing to preserve). No change to the draft-only guard or the no-send/no-pay boundary.

## Implements

- `specs/commands/invoices.md` — the `payment_options` preservation rule on `edit` (omit flag ⇒ preserve; `--payment-options ""` ⇒ explicit clear).
- `specs/api/invoices.md` — records the `payment_options`-is-not-partial-update Harvest quirk that necessitates the re-send.

## Approach

1. `requireDraft(id, "edit")` already returns the fetched draft. Capture it in `invoiceEdit`: `const current = await requireDraft(id, "edit");`.
2. Build the PATCH body and run the existing empty-body check on the **user-supplied** fields first — so an edit with no real changes still errors (we don't sneak a preservation-only PATCH).
3. **After** that check, if `f.paymentOptions === undefined` (flag absent) **and** `Array.isArray(current.payment_options) && current.payment_options.length > 0`, set `body.payment_options = current.payment_options`. When the flag *is* passed (including `--payment-options ""` → `[]`), `buildTopLevel` has already set the body value and we leave it — that's the explicit replace/clear path.
4. No output-noise change: preservation is the correct, expected behavior, not a warning.

## Validation

- [x] Draft with `["ach"]` → `invoices edit <id> --po X` (no `--payment-options`) → re-read shows `["ach"]` (was `[]` before the fix). *(live, read back via `get --raw` — the exact #9 repro, draft 52558686)*
- [x] Same preservation holds for an unrelated `--notes` edit. *(live: ach survived)*
- [x] `--payment-options credit_card` replaces (PATCH body carries `["credit_card"]`). *(unit-verified; live replace surfaced a translated `422` because `credit_card` isn't enabled on the test account — correct, and the draft kept `ach` rather than being wiped, confirming a rejected replace doesn't clear)*
- [x] `--payment-options ""` explicitly clears → `[]` (distinct from omission). *(live + unit)*
- [x] An edit naming no fields/lines still errors with the empty-change `VALIDATION_ERROR` — preservation runs **after** the (untouched) empty-body check, so it can't create a sneak PATCH. *(code-ordering)*
- [x] Unit: PATCH body carries `payment_options` from the guard GET when the flag is absent and current is non-empty; carries the parsed value when present; omits it when absent and current is empty. *(3 unit tests)*
- [x] No regression: 139 → 142 tests pass (+3).

## Risks / unknowns

- **Double-edged preservation** — re-sending the current value is correct for the omit case, but if a future Harvest change made `payment_options` partial-update-compliant, the re-send would become a harmless no-op. Low risk; documented in the API spec so the behavior is traceable.
- **Empty vs absent** — the fix hinges on distinguishing "flag omitted" (`f.paymentOptions === undefined`, preserve) from "flag empty" (`""`, clear). `parseWriteFlags` already captures the empty string distinctly, so the distinction is sound.

## Notes

- **The bug was server-side, not in the CLI.** The CLI already omitted `payment_options` when `--payment-options` was absent (the `!== undefined` guard from `invoices-write-gaps`). Harvest itself clears `payment_options` on any PATCH that doesn't re-send them — the one field that breaks Harvest's own partial-update rule. The issue's proposed fix ("omit it so Harvest leaves it untouched") was the inverse of the actual fix (re-send it). Recorded in `specs/api/invoices.md` so a future "simplify the edit body" change doesn't reintroduce the regression.
- **Blast radius audited live before fixing:** `tax`/`tax2`/`discount`/`currency` and line items all survive an unrelated edit untouched; `payment_options` is the sole exception. Fix scoped to it alone.
- **No extra round-trip:** preservation reuses the invoice the `requireDraft` guard already GETs.
- **Omit-vs-empty distinction is load-bearing:** `--payment-options` absent → preserve; `--payment-options ""` → explicit `[]`. `parseWriteFlags` captures the empty string as defined-but-empty, so the two are cleanly separable.

## Follow-ups

- The `parsePaymentOptions` vocabulary check passes `credit_card`/`paypal` even when the account hasn't enabled them, so a replace to a disabled option 422s at write time (translated). Pre-validating against account-enabled options would need an extra lookup; not worth it. **Tracked as:** accept the translated 422 as the signal (matches how disabled/cross-client line projects already behave).
