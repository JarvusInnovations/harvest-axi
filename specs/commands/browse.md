# Command: browse (clients, projects, tasks, users, assignments)

Read-only reference data. Exists to (a) give the agent valid ids/names for `review` and `entries` scoping, (b) back the name→id **resolution cache** those commands use, and (c) let an agent inspect any single client/project/task/user in full. Implements [api/reference-data](../api/reference-data.md). Manager/Admin gated (except the self paths).

## Subcommands

- `browse clients` — `GET /v2/clients`. `clients[N]{id,name,active}`. `--all` includes archived (default active only).
- `browse projects` — `GET /v2/projects`. `projects[N]{id,name,client,code,active}`. Filters: `--client <id|name>`, `--all`.
- `browse tasks` — `GET /v2/tasks`. `tasks[N]{id,name,billable_default,active}`.
- `browse users` — `GET /v2/users`. `users[N]{id,name,email,roles,active}`. Completes the set so `--user` resolution has a first-class list (manager-gated like the others).
- `browse mine` — **my project assignments** via `GET /v2/users/me/project_assignments`. Shows the projects I can log to and, per project, the tasks assigned. `assignments[N]{project,client,tasks}` where `tasks` is a compact count/list. This is the authoritative source for "what *can I* log against" and what `entries log` validates against.

### Common list flags

- `--all` — include archived/inactive (default: active only).
- `--since <dur>` — only entities updated within the window (maps to `updated_since`; e.g. `7d`, `2w`, `1m`). Lists otherwise return everything, paginated to completion.
- `--refresh` — bypass the resolution cache on the name-filtered paths.

## Detail views — `browse <entity> <id|name>`

A trailing positional turns any list subcommand into a single-entity **detail view**: `browse clients <id|name>`, `browse projects <id|name>`, `browse tasks <id|name>`, `browse users <id|name>`. The arg resolves through the same cache as scope flags (numeric id passes through; a name resolves case-insensitively, ambiguity → candidates). Detail is a self-contained record — full fields, no truncation, no row cap (per [AXI detail-view principle](../principles.md)).

- **client** — `id · name · active · currency · address · statement_key · created_at · updated_at`.
- **task** — `id · name · billable_by_default · default_hourly_rate · is_default · active · created_at · updated_at`.
- **user** — `id · name · email · telephone · timezone · access_roles · roles · is_contractor · weekly_capacity (hours) · default_hourly_rate · cost_rate · active`. `weekly_capacity` is rendered in hours (API gives seconds). `browse users me` (or no arg shorthand) resolves the authenticated user via `/v2/users/me`.
- **project** — the full project record **plus its task assignments**, in stacked blocks:
  - `project` — `id · name · code · client · active · is_billable · is_fixed_fee · bill_by · hourly_rate · budget · budget_by · cost_budget · fee · notes · starts_on · ends_on · created_at · updated_at`.
  - `tasks[N]{task,billable,hourly_rate,active}` — from `GET /v2/projects/{id}/task_assignments`. This is the per-project "what can be logged here" answer, folded in so no second call is needed.

## Resolution cache

- Clients/projects/tasks/users names↔ids are cached under `~/.config/harvest-axi/cache/` with a short TTL; `--refresh` forces a re-fetch. Resolution is case-insensitive substring with exact-match precedence; ambiguity returns candidates as a `VALIDATION_ERROR`, not a guess.

## Output

Each list: definitive empty state, `total` count, and a suggestion pointing at `review`/`entries log` (or the matching `browse <entity> <id>` detail) with the relevant flag carried forward. Detail views suggest the natural next action (e.g. a project's detail → `review --project "<name>"`).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Review is the center of gravity](../principles.md#review-is-the-center-of-gravity) — browse output funnels toward `review` and `entries log`.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — lists summarize; `browse <entity> <id>` is the on-demand full record (and `browse projects <id>` folds in task assignments rather than making the agent chase a second endpoint).
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — a bad id → `NOT_FOUND`, a Member token → `FORBIDDEN`, both actionable.
