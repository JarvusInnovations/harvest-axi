# API: Time Entries

Source: <https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/>. The endpoint group at the heart of harvest-axi.

## LIST — `GET /v2/time_entries`

Returns entries sorted by `spent_date` (newest first), paginated (see [conventions](conventions.md#pagination)).

### Filters (all optional, AND-combined server-side)

| Param | Type | Meaning |
|-------|------|---------|
| `user_id` | int | one user's entries |
| `client_id` | int | one client's entries |
| `project_id` | int | one project's entries |
| `task_id` | int | one task's entries |
| `is_billed` | bool | invoiced vs not |
| `is_running` | bool | active timers only |
| `approval_status` | enum | `unsubmitted` \| `submitted` \| `approved` |
| `from` | date | `spent_date` on/after |
| `to` | date | `spent_date` on/before |
| `updated_since` | datetime | changed after timestamp |
| `page` / `per_page` | int | pagination |

> Server-side `from`/`to`/`*_id` filtering is why period-review is a single paginated query, **not** a fan-out (the key advantage over the Slack model).

### Time entry object (fields harvest-axi reads)

`id` · `spent_date` · `hours` · `rounded_hours` · `notes` · `is_running` · `is_billed` · `billable` · `approval_status` · `is_locked` · `timer_started_at` · `started_time` · `ended_time` · `created_at` · `updated_at` and nested:

- `user`: `{ id, name }`
- `client`: `{ id, name }`
- `project`: `{ id, name, code }`
- `task`: `{ id, name }`
- `billable_rate`, `cost_rate` (decimals; may be null per role)

## CREATE — `POST /v2/time_entries`

Required: `project_id`, `task_id`, `spent_date`. `user_id` defaults to the authenticated user.

- **Duration mode:** optional `hours` (+ `notes`). Omit `hours` → entry created running (`is_running: true`).
- **Start/end mode:** optional `started_time` / `ended_time` (+ `notes`). Omit `ended_time` → running.

Which mode an account uses depends on its Harvest settings; the create command supports both via `--hours` vs `--started/--ended`.

## UPDATE — `PATCH /v2/time_entries/{id}`

Updatable: `project_id`, `task_id`, `spent_date`, `started_time`, `ended_time`, `hours`, `notes`. Only supplied fields change.

## DELETE — `DELETE /v2/time_entries/{id}`

Removes an entry. Cannot delete locked/approved entries (non-admins) or entries on archived projects/tasks.

## TIMER — `PATCH /v2/time_entries/{id}/restart` · `PATCH /v2/time_entries/{id}/stop`

Restart a stopped entry's timer; stop a running one. Per [idempotency](../principles.md#idempotent-non-interactive-mutations): stopping an already-stopped (or restarting an already-running) entry is a no-op with exit 0.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Review is the center of gravity](../principles.md#review-is-the-center-of-gravity) — the LIST filters define the review scope axes (user/client/project/task).
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — governs the timer no-op behavior and self-default on writes.
