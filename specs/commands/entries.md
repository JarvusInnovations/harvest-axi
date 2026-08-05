# Command: entries

The entry-level surface: batch and single reads, plus writes (create/edit/delete/timer). Implements [api/time-entries](../api/time-entries.md). Writes default to the authenticated user.

## Reads

- `entries list [filters]` — **the batch read**: every entry matching a scope + window, paginated to completion. See below.
- `entries today` / `entries yesterday` — shorthand for a flat self list on that day (range-stamped header, `entries[N]{id,project,task,hours,notes,running}`).
- `entries get <id>` — full detail of one entry: all readable fields, notes shown in full (self-contained detail view → no truncation, no suggestions per AXI principle 9).

### `entries list [filters]` — batch read

Answers "give me the entries themselves, for this scope and window" — the entry-level
counterpart to [review](review.md), which answers "what do they add up to". Where
`review` leads with rollups and treats raw rows as a drill-down, `entries list` is
row-first and is the surface a script exports from (see
[machine-output](../behaviors/machine-output.md)).

Filters — the same vocabulary as `review`, so the two are learnable as one:

- `--user <id|name>` (default: self) · `--project <id|name>` · `--client <id|name>` · `--task <id|name>` — names resolve via the [browse](browse.md) cache
- `--team` — all visible users. Contradicts `--user`; the pair is rejected per [flag-validation](../behaviors/flag-validation.md)
- `--from <date> --to <date>` · `--since <dur>` · named windows (`--this-month`, `--last-month`, …) per [date-ranges](../behaviors/date-ranges.md). Default: `--since 7d`
- `--billable | --non-billable` · `--unbilled` · `--approval <status>`
- `--rounded` — display `rounded_hours` in the `hours` column (the machine payload always carries both)
- `--limit <n>` — cap on displayed rows (default 200), announced loudly when hit. **Does not cap the export file.**
- `--fields <list>` — extra columns: `notes, billable, is_billed, approval, client, rounded_hours, billable_rate`
- `--json-out[=path]` · `--csv-out[=path]` — full payload to a file, additively

Header: `range:` + `scope:` + `total_hours` · `entries` · `complete`, per
[period-review](../behaviors/period-review.md#output-shape).

Rows: `entries[N]{id,spent_date,user,project,task,hours}` (+ `--fields`).

Suggestions funnel to `entries get <id>`, narrowing by `--project`, and `review` for
the rollup view.

#### Relationship to `review --by none`

`review --by none` remains a **reading** path — an agent that drilled from a rollup into
raw rows stays inside `review`. It does not gain export flags. `entries list` is where a
script goes. The overlap is deliberate: same rows, different framing, and only one of
them is a machine-output surface.

## Writes (self by default; `--user <id|name>` to act on another, where permitted)

- `entries log` — create. Required: `--project <id|name>` `--task <id|name>`. One of: `--hours <h>` (duration mode) or `--started <time> [--ended <time>]` (start/end mode). Optional: `--date <date>` (default today), `--notes <text>`. Omitting hours/ended creates a **running** entry. Returns the created entry's id + summary.
- `entries edit <id>` — PATCH supplied fields only: `--hours`, `--notes`, `--project`, `--task`, `--date`, `--started`, `--ended`. Unspecified fields untouched.
- `entries delete <id>` — delete. Idempotent: already-absent id → no-op exit 0. Locked/approved entry → `VALIDATION_ERROR` explaining why.
- `entries start <id>` / `entries stop <id>` — timer restart/stop. Idempotent: stopping a stopped entry (or starting a running one) is a no-op exit 0. `entries start` with no id but a `--project/--task` creates a new running entry (delegates to `log` without hours).

## Resolution

`--project/--task/--client/--user` accept names resolved via the [browse](browse.md) cache; ambiguous names → `VALIDATION_ERROR` listing candidates. Logging requires a project the user is assigned to and a task assigned to that project — a mismatch surfaces the assignment list.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — delete/start/stop no-ops, self-default, flags-only.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — 422 from Harvest surfaces the rejected field + the assignment fix.
- [Preview to stdout, full data to a file](../principles.md#preview-to-stdout-full-data-to-a-file) — `entries list` is one of the two surfaces that earned machine output; see [machine-output](../behaviors/machine-output.md) for the recurring use case that justifies it.
- [Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap) — `entries list` pages to completion and announces `--limit`; the export file ignores the cap entirely.
