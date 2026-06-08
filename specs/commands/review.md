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
  --team               all users you can see
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

## Output

Per [period-review](../behaviors/period-review.md#output-shape): a header of `range:` + `scope:` + structured totals (`total_hours`, `billable_hours`, `non_billable_hours`, `entries`, `complete`), then a `by_<axis>[N]{...}` rollup table sorted by hours desc, then suggestions. `complete:` reflects full pagination. `--by none` emits an `entries[N]{id,spent_date,user,project,task,hours}` table with the same header.

## Default schemas

- Rollup row: `{ <axis>, hours, billable, entries }`.
- Raw entry row (`--by none`): `{ id, spent_date, user, project, task, hours }` (+ `--fields`).

## Suggestions

- After a rollup → offer regrouping (`--by project`/`--by user`) and drilling (`--by none`, or `--project <name>` to narrow).
- After `--by none` → `Run \`harvest-axi entries get <id>\` for one entry`.
- After empty → broaden the window / drop refinements.

## Examples

```
harvest-axi review                          # your last 7 days, by day
harvest-axi review --team --this-week       # everyone this week, by user
harvest-axi review --client Acme --last-month --by project
harvest-axi review --project "Acme Redesign" --by task --unbilled
harvest-axi review --user "Jane Doe" --since 2w --by none
```
