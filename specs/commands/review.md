# Command: review

The centerpiece. Implements [behaviors/period-review](../behaviors/period-review.md) and [behaviors/date-ranges](../behaviors/date-ranges.md).

## Invocation

`harvest-axi review [window] [scope] [--by axis] [flags]`

## Flags

```
time window (see date-ranges):
  --since <dur>        7d | 2w | 1m  (default: --since 7d for self, this-week for --team)
  --from <date> --to <date>
  --today --yesterday --this-week --last-week --this-month --last-month
scope:
  (default)            your own entries
  --team               all users you can see (contradicts --user — the pair is rejected)
  --user <id|name>     a specific user
  --project <id|name>  one project
  --client <id|name>   one client
  --task <id|name>     one task
refine:
  --billable | --non-billable
  --unbilled           uninvoiced entries only
  --approval <status>  unsubmitted | submitted | approved
grouping & detail:
  --by <axis>          user|project|client|task|day|none (default per scope)
  --rounded            use rounded_hours instead of hours
  --limit <n>          cap raw rows under --by none (default 200, loud when hit)
  --fields <list>      extra columns on raw rows: notes, billable, approval, client
```

## Scope resolution

Exactly one user scope applies, and the flags that select it are **mutually exclusive**,
never precedence-ordered:

- Neither `--team` nor `--user` → the authenticated user.
- `--user <id|name>` → that user. An unresolvable reference is an error naming the value.
- `--team` → all visible users.
- **`--team` together with `--user` is a `VALIDATION_ERROR`** (exit 2), suggesting
  `--user <id>` alone for one user or `--team --by user` for a per-user breakdown.
  Silently letting `--team` win returns whole-team totals under a single-user label —
  [#14](https://github.com/JarvusInnovations/harvest-axi/issues/14) — which is the exact
  wrong-but-plausible failure [flag-validation](../behaviors/flag-validation.md) exists
  to prevent.

`--project` / `--client` / `--task` are independent narrowing filters and combine freely
with any user scope.

## Machine output

`review` has **no** `--json-out` / `--csv-out`, at any `--by` axis including `none`. Its
rollups are agent-read — a model lifts a total straight out of the TOON — and its raw
rows are a drill-down for reading, not a script's batch source. A script that needs the
entries themselves uses [`entries list`](entries.md#entries-list-filters). See
[machine-output](../behaviors/machine-output.md) for the earned-not-uniform rule.

## Output

Per [period-review](../behaviors/period-review.md#output-shape): a header of `range:` + `scope:` + structured totals (`total_hours`, `billable_hours`, `non_billable_hours`, `entries`, `complete`), then a `by_<axis>[N]{...}` rollup table sorted by hours desc, then suggestions. `complete:` reflects full pagination. `--by none` emits an `entries[N]{id,spent_date,user,project,task,hours}` table with the same header.

## Default schemas

- Rollup row: `{ <axis>, hours, billable, entries }`.
- Raw entry row (`--by none`): `{ id, spent_date, user, project, task, hours }` (+ `--fields`).

## Suggestions

- After a rollup → offer regrouping (`--by project`/`--by user`) and drilling (`--by none`, or `--project <name>` to narrow).
- After `--by none` → `Run \`harvest-axi entries get <id>\` for one entry`, and`Run \`harvest-axi entries list --json-out\` to export the batch` — the handoff to the machine-output surface, since an agent that drilled to raw rows is one step from wanting them in a script.
- After empty → broaden the window / drop refinements.

## Examples

```
harvest-axi review                          # your last 7 days, by day
harvest-axi review --team --this-week       # everyone this week, by user
harvest-axi review --client Acme --last-month --by project
harvest-axi review --project "Acme Redesign" --by task --unbilled
harvest-axi review --user "Jane Doe" --since 2w --by none
```
