# Command: invoices

The billing surface — list/review invoices, read one in full, and a **draft workbench** for building them. Implements [api/invoices](../api/invoices.md). Every subcommand is **Admin/Manager-gated** by the API; a non-manager token gets a translated `FORBIDDEN`.

## Reads

### `invoices [filters]` — list / review

The headline read: "show me the invoices, scoped this way." Paginates to completion. Leads with a totals + by-state header (the answer before any row), then the rows.

Filters:

- `--state <draft|open|paid|closed>` · `--drafts` (shortcut for `--state draft` — the "review draft ones" workflow)
- `--client <id|name>` · `--project <id|name>` (names resolve via the [browse](browse.md) cache)
- `--from <date> --to <date>` · `--since <dur>` (maps to `updated_since`) · named windows (`--this-month`, `--last-month`, …) — filter on `issue_date` per [date-ranges](../behaviors/date-ranges.md)
- `--limit <n>` — cap on the raw row list (default 200); the cap is announced loudly, never silent

Header: `{ range, scope, total, draft, open, paid, closed, amount, due, currency, complete }` — counts per state and summed `$ amount` / `$ due` (currency noted; `(mixed currencies — not summed)` when >1 distinct). `complete` reflects pagination only.

Rows: `invoices[N]{id,number,client,state,amount,due,issue_date,due_date}`.

Suggestions funnel to `invoices get <id>`, `--drafts`, and (write) `invoices create --from-tracked`.

### `invoices get <id>` — full detail

A self-contained detail view (no truncation, no row cap) rendered as stacked blocks. Three GETs: the invoice + its payments + its messages.

- `invoice` — `id · number · state · client · subject · purchase_order · creator · issue_date · due_date · payment_term · period_start · period_end · payment_options · created_at · updated_at`
- `money` — `amount · due_amount · currency · tax · tax_amount · tax2 · tax2_amount · discount · discount_amount`
- `lifecycle` — `sent_at · paid_at · paid_date · closed_at`
- `links` — `web` + `pdf` public URLs composed from `client_key`
- `references` — `estimate · retainer · recurring_invoice_id` (only the present ones)
- `line_items[N]{kind,description,project,quantity,unit_price,amount,taxed}`
- `payments[N]{paid_date,amount,recorded_by,notes}` — folded in from the payments sub-resource
- `messages[N]{sent_at,event_type,recipients,subject}` — the send/transition history

`--raw` dumps the untranslated invoice JSON for any field not mapped above.

## Writes — draft workbench only

Every write here produces or mutates a **`draft`**. The agent never finalizes, sends, closes, or records payment (see the [write boundary](../api/invoices.md#write-boundary--out-of-scope-deliberate-recorded)).

### `invoices create` — new draft

Required: `--client <id|name>`. New invoices are born `draft`. Two modes:

- **Free-form** (default): one or more `--line "<kind>|<unit_price>|<quantity>|<description>"` items (or a simpler repeatable flag set — exact surface settled in the plan), plus optional `--subject`, `--notes`, `--issue-date`, `--due-date`, `--payment-term`, `--tax`, `--discount`, `--po`.
- **From tracked time/expenses** — `--from-tracked`: requires `--project <id|name>` (≥1, repeatable) → `project_ids`; `--summary <project|task|people|detailed>` (default `project`); optional `--from/--to` window (omitted → all unbilled). Turns [`review`](review.md)'s data into a draft. Expenses import is available via `--expenses` with its own summary type.

Returns the created draft's id + a summary, and a suggestion to `invoices get <id>` to review it.

### `invoices edit <id>` — **draft-only**

PATCHes supplied top-level fields (`--subject`, `--notes`, `--issue-date`, `--due-date`, `--payment-term`, `--tax`, `--discount`, `--po`) and line-item operations (add / edit-by-id / remove-by-id via `_destroy`). **Guard:** a `GET` precedes the write; if `state !== "draft"` the command fails with a `VALIDATION_ERROR` (`invoice #<id> is "<state>", not a draft — harvest-axi only edits drafts`). No network mutation occurs on a non-draft.

### `invoices delete <id>` — **draft-only**

Same draft guard. Idempotent: an already-absent id is a no-op exit 0. A non-draft invoice → `VALIDATION_ERROR`, never deleted.

## Draft-only guard (behavior)

`edit` and `delete` enforce drafts-only **client-side** via read-before-write — the Harvest API does not restrict these by state. This is a safety convention of the tool, not an account-level lock: an admin can still mutate any invoice in the Harvest UI. The guard exists so an agent cannot accidentally alter or destroy an issued/paid invoice.

## Resolution

`--client`, `--project` accept names resolved via the [browse](browse.md) cache; ambiguous names → `VALIDATION_ERROR` listing candidates, never a guess. Name resolution runs **before** any network mutation (fail fast).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — list leads with state counts + `$` totals; `get` is the on-demand full record.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — delete no-op, flags-only, the draft guard as a refusal rather than a prompt.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — `403` (manager required) and `422` (line-item/validation) become actionable AXI errors.
