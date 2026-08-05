# Command: estimates

The quoting surface — list/review estimates, read one in full, and a **draft workbench** for building them. Implements [api/estimates](../api/estimates.md). A **strict subset** of [`invoices`](invoices.md): same structure and conventions, minus payments, payment terms/options, tracked-time import, and project-linked line items. Every subcommand is **Admin/Manager-gated** by the API; a non-manager token gets a translated `FORBIDDEN`.

## Reads

### `estimates [filters]` — list / review

The headline read: "show me the estimates, scoped this way." Paginates to completion. Leads with a totals + by-state header (the answer before any row), then the rows.

Filters:

- `--state <draft|sent|accepted|declined>` · `--drafts` (shortcut for `--state draft` — the "review draft ones" workflow)
- `--client <id|name>` (names resolve via the [browse](browse.md) cache) — **no `--project`** (the Estimates API has no project filter)
- `--from <date> --to <date>` · `--since <dur>` (maps to `updated_since`) · named windows (`--this-month`, `--last-month`, …) — filter on `issue_date` per [date-ranges](../behaviors/date-ranges.md)
- `--limit <n>` — cap on the raw row list (default 200); the cap is announced loudly, never silent

Header: `{ range, scope, total, draft, sent, accepted, declined, amount, currency, complete }` — counts per state and summed `$ amount` (currency noted; `(mixed currencies — not summed)` when >1 distinct). No `due` (estimates have no balance). `complete` reflects pagination only.

Rows: `estimates[N]{id,number,client,state,amount,issue_date}`.

Suggestions funnel to `estimates get <id>`, `--drafts`, and `estimates create`.

### `estimates get <id>` — full detail

A self-contained detail view (no truncation, no row cap) rendered as stacked blocks. Two GETs: the estimate + its messages (no payments sub-resource exists).

- `estimate` — `id · number · state · client · subject · purchase_order · creator · issue_date · created_at · updated_at`
- `money` — `amount · currency · tax · tax_amount · tax2 · tax2_amount · discount · discount_amount`
- `lifecycle` — `sent_at · accepted_at · declined_at`
- `links` — `web` + `pdf` public URLs composed from `client_key`
- `line_items[N]{kind,description,quantity,unit_price,amount,taxed}` — no `project` column (estimate lines aren't project-linked)
- `messages[N]{sent_at,event_type,recipients,subject}` — the send/transition history

There is no `--raw` — removed with a migration hint for the same reason as on
[invoices](invoices.md): it advertised JSON but rendered TOON. `estimates` has no
recurring script use case, so it gains no export flag either (see
[machine-output](../behaviors/machine-output.md)); the blocks above are the detail view.

## Writes — draft workbench only

Every write here produces or mutates a **`draft`**. The agent never finalizes, sends, accepts, or declines (see the [write boundary](../api/estimates.md#write-boundary--out-of-scope-deliberate-recorded)).

### `estimates create` — new draft

Required: `--client <id|name>`. New estimates are born `draft`. One mode — **free-form** (no `--from-tracked` import; the Estimates API has no `line_items_import`):

- One or more `--line "<kind>|<unit_price>|<quantity>|<description>"` items, plus optional `--subject`, `--notes`, `--issue-date`, `--tax`, `--tax2`, `--discount`, `--po`, `--currency`.
- The `--line` spec has **four** segments (max), not five — there is **no trailing `<project>` segment**, because estimate line items carry no `project_id`.

Returns the created draft's id + a summary echoing the resulting line items, plus a suggestion to `estimates get <id>` to review it.

### `estimates edit <id>` — **draft-only**

PATCHes supplied top-level fields (`--subject`, `--notes`, `--issue-date`, `--tax`, `--tax2`, `--discount`, `--po`, `--currency`) and line-item operations (add via `--line` / edit-by-id via `--update-line "<id>|<kind>|<unit_price>|<quantity>|<description>"` with blank = keep / remove-by-id via `--remove-line`). **Guard:** a `GET` precedes the write; if `state !== "draft"` the command fails with a `VALIDATION_ERROR` (`estimate #<id> is "<state>", not a draft — harvest-axi only edits drafts`). No network mutation occurs on a non-draft.

> **No `payment_options` preservation step.** Unlike [`invoices edit`](invoices.md#invoices-edit-id--draft-only), estimates have no `payment_options` field, so the invoices re-send-to-preserve workaround (issue #9) does **not** apply — every PATCH field is honest partial-update.

### `estimates delete <id>` — **draft-only**

Same draft guard. Idempotent: an already-absent id is a no-op exit 0. A non-draft estimate → `VALIDATION_ERROR`, never deleted.

## Draft-only guard (behavior)

`edit` and `delete` enforce drafts-only **client-side** via read-before-write — the Harvest API does not restrict these by state. This is a safety convention of the tool, not an account-level lock: an admin can still mutate any estimate in the Harvest UI. The guard exists so an agent cannot accidentally alter or destroy a sent/accepted estimate. (Identical to the [invoices guard](invoices.md#draft-only-guard-behavior).)

## Resolution

`--client` accepts a name resolved via the [browse](browse.md) cache; ambiguous names → `VALIDATION_ERROR` listing candidates, never a guess. Name resolution runs **before** any network mutation (fail fast).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — list leads with state counts + `$` total; `get` is the on-demand full record.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — delete no-op, flags-only, the draft guard as a refusal rather than a prompt.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — `403` (manager required) and `422` (line-item/validation) become actionable AXI errors.
