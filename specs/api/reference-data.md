# API: Reference Data (clients, projects, tasks, users)

Sources: [clients](https://help.getharvest.com/api-v2/clients-api/clients/clients/) · [projects](https://help.getharvest.com/api-v2/projects-api/projects/projects/) · [tasks](https://help.getharvest.com/api-v2/tasks-api/tasks/tasks/) · [users](https://help.getharvest.com/api-v2/users-api/users/users/) · [project task assignments](https://help.getharvest.com/api-v2/projects-api/projects/task-assignments/). The reference entities behind [`browse`](../commands/browse.md) and the name↔id resolution cache. harvest-axi reads these (list + retrieve); it does **not** create/update/delete them.

> **Permissions.** `clients`, `projects`, `tasks`, `users` listing/retrieval requires an Administrator or Manager; a Member token gets `403` (translated to `FORBIDDEN`). `users/me` and `users/me/project_assignments` work for any role — that's the self path `entries`/`review` rely on.

## LIST endpoints

| Entity | Path | Filters |
|--------|------|---------|
| Clients | `GET /v2/clients` | `is_active`, `updated_since`, `page`/`per_page` |
| Projects | `GET /v2/projects` | `is_active`, `client_id`, `updated_since`, `page`/`per_page` |
| Tasks | `GET /v2/tasks` | `is_active`, `updated_since`, `page`/`per_page` |
| Users | `GET /v2/users` | `is_active`, `updated_since`, `page`/`per_page` |

All paginate like the rest of the API (`<key>` array + `total_entries`/`total_pages`/`links`), so the lists must paginate to completion (see [principles](../principles.md#paginate-to-completion-never-silently-cap)). `is_active` is applied client-side today (active-only default, `--all` to include archived); `updated_since` backs a `--since` filter.

## RETRIEVE endpoints

`GET /v2/clients/{id}` · `GET /v2/projects/{id}` · `GET /v2/tasks/{id}` · `GET /v2/users/{id}` — each returns the full object, `200 OK` for a valid id, `404` otherwise. `GET /v2/users/me` retrieves the authenticated user (any role).

### Client object

`id` · `name` · `is_active` · `address` · `statement_key` (builds the client statement URL) · `currency` · `created_at` · `updated_at`.

### Project object

`id` · `name` · `code` · `client` `{id,name,currency}` · `is_active` · `is_billable` · `is_fixed_fee` · `bill_by` · `hourly_rate` · `budget` · `budget_by` · `budget_is_monthly` · `notify_when_over_budget` · `over_budget_notification_percentage` · `show_budget_to_all` · `cost_budget` · `fee` · `notes` · `starts_on` · `ends_on` · `created_at` · `updated_at`.

### Task object

`id` · `name` · `billable_by_default` · `default_hourly_rate` · `is_default` · `is_active` · `created_at` · `updated_at`.

### User object

`id` · `first_name` · `last_name` · `email` · `telephone` · `timezone` · `has_access_to_all_future_projects` · `is_contractor` · `is_active` · `weekly_capacity` (seconds — 35h ⇒ 126000) · `default_hourly_rate` · `cost_rate` · `roles` (array) · `access_roles` (`administrator`|`manager`|`member`) · `avatar_url` · `created_at` · `updated_at`.

## Project Task Assignments

The tasks assignable on a project — the authoritative "what can be logged against this project" data.

| Endpoint | Path | Filters |
|----------|------|---------|
| Per project | `GET /v2/projects/{PROJECT_ID}/task_assignments` | `is_active`, `updated_since`, `page`/`per_page` |
| All assignments | `GET /v2/task_assignments` | same |

### Task assignment object

`id` · `task` `{id,name}` · `project` `{id,name,code}` · `is_active` · `billable` · `hourly_rate` (used when project `bill_by` is Tasks) · `budget` (when `budget_by` is task/task_fees) · `created_at` · `updated_at`.

> harvest-axi folds the **per-project** assignments into `browse projects <id>` detail, so an agent sees a project's billable tasks (and their rates) in one call — the data that otherwise required a raw API hit. The self-scoped `GET /v2/users/me/project_assignments` (used by `browse mine`) remains the path for "what *I* can log against."

## Client Contacts

The people at a client — invoice recipients and points of contact. Source: [client contacts](https://help.getharvest.com/api-v2/clients-api/clients/contacts/). Manager/Admin gated like the rest. harvest-axi reads these (list + retrieve); no create/update/delete.

| Operation | Path | Filters |
|-----------|------|---------|
| List | `GET /v2/contacts` | `client_id`, `updated_since`, `page`/`per_page` |
| Retrieve | `GET /v2/contacts/{id}` | — |

> There is **no** `GET /v2/clients/{id}/contacts` nested route — filter the list by `client_id` instead. harvest-axi folds a client's contacts into `browse clients <id>` detail via that filter.

### Contact object

`id` · `client` `{id,name}` · `title` · `first_name` · `last_name` · `email` · `phone_office` · `phone_mobile` · `fax` · `invoice_recipient_status` (`none`|`recipient`|`cc`|`bcc`) · `created_at` · `updated_at`.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap) — every list sweeps all pages.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — lists carry minimal columns; `browse <entity> <id>` is the on-demand full record.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — `403` (role) and `404` (bad id) translate to actionable AXI errors.
