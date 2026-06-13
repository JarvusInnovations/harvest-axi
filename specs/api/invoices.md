# API: Invoices

Source: <https://help.getharvest.com/api-v2/invoices-api/invoices/invoices/> (+ the [invoice-messages](https://help.getharvest.com/api-v2/invoices-api/invoices/invoice-messages/) and [invoice-payments](https://help.getharvest.com/api-v2/invoices-api/invoices/invoice-payments/) sub-resources). The billing side of harvest-axi, distinct from [time-entries](time-entries.md).

> **Permission gate.** Every invoices endpoint — **read and write** — requires an Administrator or a Manager with invoice create/edit rights. Anything else returns `403 Forbidden`, which the client translates to a `FORBIDDEN` AXI error pointing at the role requirement. This is unlike time-entries (readable by any user for their own data), so the home/doctor surface must degrade gracefully for non-managers rather than erroring.

## LIST — `GET /v2/invoices`

Returns invoices sorted by `issue_date` (most recently issued first), paginated (see [conventions](conventions.md#pagination)).

### Filters (all optional, AND-combined server-side)

| Param | Type | Meaning |
|-------|------|---------|
| `client_id` | int | one client's invoices |
| `project_id` | int | one project's invoices |
| `state` | enum | `draft` \| `open` \| `paid` \| `closed` |
| `from` | date | `issue_date` on/after |
| `to` | date | `issue_date` on/before |
| `updated_since` | datetime | changed after timestamp |
| `page` / `per_page` | int | pagination (`per_page` 1–2000, default 100) |

## RETRIEVE — `GET /v2/invoices/{id}`

The full invoice object. Fields harvest-axi reads, grouped:

**Identity & references**
`id` · `number` · `purchase_order` · `subject` · `notes` · `state` · `client_key` (builds the public URL — see below) and nested: `client` `{id,name}` · `creator` `{id,name}` · `estimate` · `retainer` · `recurring_invoice_id`.

**Money**
`amount` (total incl. tax & discount) · `due_amount` (outstanding now) · `currency` · `tax` / `tax_amount` · `tax2` / `tax2_amount` · `discount` / `discount_amount`. (`tax`/`tax2`/`discount` are percentages; the `*_amount` fields are computed dollars, null when the rate is unset.)

**Dates & terms**
`issue_date` · `due_date` · `payment_term` (`upon receipt` \| `net 15` \| `net 30` \| `net 45` \| `net 60` \| `custom`) · `period_start` / `period_end` (the time-tracking period billed) · `payment_options` (`[ach, credit_card, paypal]`).

**Lifecycle timestamps**
`sent_at` · `paid_at` / `paid_date` · `closed_at` · `created_at` · `updated_at`.

**Line items** (`line_items[]`, each)
`id` · `kind` · `description` · `quantity` · `unit_price` · `amount` (`quantity * unit_price`) · `taxed` / `taxed2` and nested `project` `{id,name,code}`.

### Public web URL (from `client_key`)

The client-facing invoice lives at `https://{SUBDOMAIN}.harvestapp.com/client/invoices/{client_key}`; append `.pdf` for the PDF. harvest-axi composes these from `client_key` so the agent can surface a shareable link without an extra call.

## States

`draft` → `open` → `paid`, plus `closed` (written off). Only `draft` is editable/deletable in harvest-axi (see the write boundary below). State transitions happen via the **messages** sub-resource, which harvest-axi does **not** expose.

## CREATE — `POST /v2/invoices`

Returns `201 Created`. New invoices are created in **`draft`** state. Two mutually-exclusive shapes:

### Free-form — explicit `line_items`

Required: `client_id`. Optional top-level: `number`, `purchase_order`, `subject`, `notes`, `currency`, `tax`, `tax2`, `discount`, `issue_date`, `due_date`, `payment_term`, `payment_options`, `estimate_id`, `retainer_id`.

`line_items[]` — each: `kind` (req), `unit_price` (req), `quantity` (opt, default 1), `description` (opt), `project_id` (opt), `taxed` / `taxed2` (opt, default false).

> `due_date`: to set a custom value, `payment_term` must also be `custom`; otherwise it is computed from `issue_date` + `payment_term`.

### From tracked time & expenses — `line_items_import`

Same top-level params (plus `estimate_id`; no `retainer_id`), but `line_items_import` replaces `line_items`:

- `project_ids` (array, **required**)
- `time` (object, opt): `summary_type` (req — `project` \| `task` \| `people` \| `detailed`), `from` / `to` (opt, must be paired)
- `expenses` (object, opt): `summary_type` (req — `project` \| `category` \| `people` \| `detailed`), `from` / `to` (opt, paired), `attach_receipts` (opt, default false)

> If neither `from`/`to` is given, **all unbilled** entries/expenses are imported. This is the bridge from tracked time → a draft invoice, tying directly into the data [`review`](../commands/review.md) reads.

## UPDATE — `PATCH /v2/invoices/{id}`

Returns `200 OK`. Partial — unspecified fields are left unchanged. Accepts the same top-level fields as create, plus `line_items` with per-item operations:

- **add** — line item object **without** an `id`
- **edit** — line item object **with** its `id` + changed fields
- **delete** — `{"id": <id>, "_destroy": true}`

## DELETE — `DELETE /v2/invoices/{id}`

Returns `200 OK`.

## Sub-resources harvest-axi READS (for `invoices get`)

- **Payments** — `GET /v2/invoices/{id}/payments`. Payment object: `id` · `amount` · `paid_at` / `paid_date` · `recorded_by` · `notes` · `transaction_id` · `payment_gateway`. Sorted newest-first.
- **Messages** — `GET /v2/invoices/{id}/messages`. The send/transition history: `id` · `sent_at` · `event_type` (null for an actual email send; `send`/`close`/`re-open`/`draft` for transitions) · `recipients` · `subject` · `body`.

## Write boundary — OUT of scope (deliberate, recorded)

harvest-axi is a **draft workbench**. The following Invoices-API mutations exist but are intentionally **not wired**, because each is outward-facing, money-moving, or acts on an already-issued invoice:

| Action | Endpoint | Why held |
|--------|----------|----------|
| Email invoice to client | `POST /v2/invoices/{id}/messages` (no `event_type`) | Actually emails the client — irreversible, external |
| Mark as sent (draft → open) | `POST .../messages` `event_type: send` | Finalizes/issues an invoice; pure-workbench keeps the agent on drafts only |
| Close (write off) / re-open | `POST .../messages` `event_type: close` / `re-open` | Acts on issued invoices |
| Mark open → draft | `POST .../messages` `event_type: draft` | Reverses a finalize the agent never performs |
| Record / delete a payment | `POST` / `DELETE /v2/invoices/{id}/payments[/{id}]` | Financial record; `send_thank_you` defaults true → emails the client |
| Delete a message | `DELETE .../messages/{id}` | Acts on send history |

The complementary client-side rule: **`edit` and `delete` operate only on `draft` invoices** — enforced by a read-before-write state check, since the API itself does not gate it. See [commands/invoices](../commands/invoices.md).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap) — the LIST sweep and the per-invoice payments/messages reads paginate to completion.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — the list header leads with count + `$ amount`/`$ due` + by-state breakdown; `get` is the on-demand detail.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — `delete` of an absent draft is a no-op exit 0; writes complete with flags alone.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — `403` (role) and `422` (validation) translate to actionable AXI errors.
