# Command: browse (clients, projects, tasks, assignments)

Read-only reference data. Exists to (a) give the agent valid ids/names for `review` and `entries` scoping, and (b) back the name→id **resolution cache** those commands use.

## Subcommands

- `browse clients` — `GET /v2/clients`. `clients[N]{id,name,active}`. `--all` includes archived (default active only).
- `browse projects` — `GET /v2/projects`. `projects[N]{id,name,client,code,active}`. Filters: `--client <id|name>`, `--all`.
- `browse tasks` — `GET /v2/tasks`. `tasks[N]{id,name,billable_default,active}`.
- `browse mine` — **my project assignments** via `GET /v2/users/me/project_assignments`. Shows the projects I can log to and, per project, the tasks assigned. `assignments[N]{project,client,tasks}` where `tasks` is a compact count/list. This is the authoritative source for "what can I log against" and what `entries log` validates against.

## Resolution cache

- Clients/projects/tasks names↔ids are cached under `~/.config/harvest-axi/cache/` with a short TTL; `--refresh` forces a re-fetch. Resolution is case-insensitive substring with exact-match precedence; ambiguity returns candidates as a `VALIDATION_ERROR`, not a guess.

## Output

Each list: definitive empty state, `total` count, and a suggestion pointing at `review`/`entries log` with the relevant `--project`/`--client`/`--task` flag carried forward.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Review is the center of gravity](../principles.md#review-is-the-center-of-gravity) — browse output funnels toward `review` and `entries log`.
- [Rollups over raw; detail on demand](../principles.md#rollups-over-raw-detail-on-demand) — `browse mine` summarizes tasks per project rather than dumping every assignment row.
