# API: Estimates

Source: <https://help.getharvest.com/api-v2/estimates-api/estimates/estimates/> (+ the [estimate-messages](https://help.getharvest.com/api-v2/estimates-api/estimates/estimate-messages/) sub-resource). The quoting side of harvest-axi — a **strict subset** of [invoices](invoices.md): same draft-workbench shape, but no money-movement, no tracked-time import, and no project-linked line items.

> **Permission gate.** Every estimates endpoint — **read and write** — requires an Administrator or a Manager with estimate create/edit rights. Anything else returns `403 Forbidden`, which the client translates to a `FORBIDDEN` AXI error pointing at the role requirement. Same gate as [invoices](invoices.md), and unlike time-entries (readable by any user for their own data).

## How estimates differ from invoices (the subset boundary)

Estimates reuse the invoices machinery, minus four whole capabilities the Estimates API simply does not have:

| Invoices has | Estimates | Consequence |
|--------------|-----------|-------------|
| `due_amount`, payments sub-resource | — | No outstanding balance; no `payments` block in `get` |
| `payment_term`, `due_date`, `payment_options` | — | No terms/options flags; **no `payment_options` partial-update gotcha** |
| `line_items_import` (from tracked time/expenses) | — | No `--from-tracked`; estimates are free-form lines only |
| `line_items[].project_id` | — | Line items carry **no project link** — no project token to parse/resolve |
| `period_start`/`period_end`, `retainer`, `recurring_invoice_id` refs | — | No billing-period or references block |
| states `draft·open·paid·closed` | `draft·sent·accepted·declined` | Different rollup keys + lifecycle timestamps |

Everything else — pagination, the totals + by-state header, the `client_key`→public-URL composition, the draft-only write guard, the messages read sub-resource, name resolution — is the same as invoices.

## LIST — `GET /v2/estimates`

Returns estimates sorted by `issue_date` (most recently issued first), paginated (see [conventions](conventions.md#pagination)).

### Filters (all optional, AND-combined server-side)

| Param | Type | Meaning |
|-------|------|---------|
| `client_id` | int | one client's estimates |
| `state` | enum | `draft` \| `sent` \| `accepted` \| `declined` |
| `from` | date | `issue_date` on/after |
| `to` | date | `issue_date` on/before |
| `updated_since` | datetime | changed after timestamp |
| `page` / `per_page` | int | pagination (`per_page` 1–2000, default 2000) |

> No `project_id` filter — the Estimates API does not scope by project (estimate line items aren't project-linked).

## RETRIEVE — `GET /v2/estimates/{id}`

The full estimate object. Fields harvest-axi reads, grouped:

**Identity & references**
`id` · `number` · `purchase_order` · `subject` · `notes` · `state` · `client_key` (builds the public URL — see below) and nested: `client` `{id,name}` · `creator` `{id,name}`.

**Money**
`amount` (total incl. tax & discount) · `currency` · `tax` / `tax_amount` · `tax2` / `tax2_amount` · `discount` / `discount_amount`. (`tax`/`tax2`/`discount` are percentages; the `*_amount` fields are computed dollars, null when the rate is unset.) No `due_amount` — an estimate has no outstanding balance.

**Dates**
`issue_date`. No `payment_term`, `due_date`, `period_start`/`period_end`, or `payment_options` — none exist on an estimate.

**Lifecycle timestamps**
`sent_at` · `accepted_at` · `declined_at` · `created_at` · `updated_at`.

**Line items** (`line_items[]`, each)
`id` · `kind` · `description` · `quantity` · `unit_price` · `amount` (`quantity * unit_price`) · `taxed` / `taxed2`. **No nested `project`** — estimate line items are not project-linked.

### Public web URL (from `client_key`)

The client-facing estimate lives at `https://{SUBDOMAIN}.harvestapp.com/client/estimates/{client_key}`; append `.pdf` for the PDF. harvest-axi composes these from `client_key` + the account's `base_uri` (cached at auth setup), exactly as for invoices.

## States

`draft` → `sent` → `accepted` (or `declined`). Only `draft` is editable/deletable in harvest-axi (see the write boundary below). State transitions (`sent`/`accepted`/`declined`/`re-open`) happen via the **messages** sub-resource, which harvest-axi does **not** expose for writes.

## CREATE — `POST /v2/estimates`

Returns `201 Created`. New estimates are created in **`draft`** state. One shape — free-form `line_items` (no import path):

Required: `client_id`. Optional top-level: `number`, `purchase_order`, `subject`, `notes`, `currency`, `tax`, `tax2`, `discount`, `issue_date`.

`line_items[]` — each: `kind` (req), `unit_price` (req), `quantity` (opt, default 1), `description` (opt), `taxed` / `taxed2` (opt, default false). **No `project_id`.**

## UPDATE — `PATCH /v2/estimates/{id}`

Returns `200 OK`. Partial — unspecified fields are left unchanged (and unlike invoices, there is **no `payment_options` exception**: every field is true partial-update). Accepts the same top-level fields as create, plus `line_items` with per-item operations:

- **add** — line item object **without** an `id`
- **edit** — line item object **with** its `id` + changed fields
- **delete** — `{"id": <id>, "_destroy": true}`

## DELETE — `DELETE /v2/estimates/{id}`

Returns `200 OK`.

## Sub-resource harvest-axi READS (for `estimates get`)

- **Messages** — `GET /v2/estimates/{id}/messages`. The send/transition history: `id` · `sent_at`/`created_at` · `event_type` (null for an actual email send; `send`/`accept`/`decline`/`re-open` for transitions) · `recipients` · `subject` · `body`. Sorted newest-first. (There is **no** payments sub-resource — estimates aren't paid.)

## Write boundary — OUT of scope (deliberate, recorded)

harvest-axi is a **draft workbench**. The following Estimates-API mutations exist but are intentionally **not wired**, because each is outward-facing or acts on an already-issued estimate:

| Action | Endpoint | Why held |
|--------|----------|----------|
| Email estimate to client | `POST /v2/estimates/{id}/messages` (no `event_type`) | Actually emails the client — irreversible, external |
| Mark as sent (draft → sent) | `POST .../messages` `event_type: send` | Finalizes/issues an estimate; pure-workbench keeps the agent on drafts only |
| Mark accepted / declined | `POST .../messages` `event_type: accept` / `decline` | Records the client's decision on an issued estimate |
| Re-open | `POST .../messages` `event_type: re-open` | Reverses a transition the agent never performs |
| Delete a message | `DELETE .../messages/{id}` | Acts on send history |

The complementary client-side rule: **`edit` and `delete` operate only on `draft` estimates** — enforced by a read-before-write state check, since the API itself does not gate it. See [commands/estimates](../commands/estimates.md).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap) — the LIST sweep and the per-estimate messages read paginate to completion.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — the list header leads with count + `$ amount` + by-state breakdown; `get` is the on-demand detail.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — `delete` of an absent draft is a no-op exit 0; writes complete with flags alone.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — `403` (role) and `422` (validation) translate to actionable AXI errors.
