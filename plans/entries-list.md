---
status: planned
depends: [flag-validation]
specs:
  - specs/commands/entries.md
  - specs/api/time-entries.md
issues: [17]
---

# Plan: `entries list` — the batch entry read

## Scope

**In:** a new `entries list [filters]` subcommand — every entry matching a scope +
window, paginated to completion, row-first. Shares `review`'s filter vocabulary
(`--user/--team/--project/--client/--task`, the full date-range set,
`--billable/--non-billable/--unbilled/--approval`, `--rounded`, `--limit`, `--fields`).

**Out:** the export flags — `entries list` is *the surface they attach to*, but they land
in [`machine-output`](machine-output.md). Also out: any change to `review`, including
removing `--by none`.

## Implements

- `specs/commands/entries.md` — the `entries list` section: filters, header, row schema, suggestions, and its documented relationship to `review --by none`.
- `specs/api/time-entries.md` — the LIST endpoint with the full filter set (already specced; this adds a second consumer alongside `review`).

## Approach

`review --by none` already does most of this — it builds the query, paginates, and
renders raw rows. The work is extracting that path into a surface of its own rather than
writing a second one.

1. **Extract the shared query builder.** `review.ts:200-235` (range resolution → scope
   resolution → `resolveEntity` calls → refinement filters → `paginateAll`) becomes a
   shared helper, probably `src/harvest/entry-query.ts`, returning entries plus the
   resolved range and scope label. Both `review` and `entries list` call it. This is the
   part to get right: two divergent copies of scope resolution is exactly how #14-class
   bugs multiply.
2. **`entries list` handler** in `src/commands/entries.ts` — call the shared builder,
   render the `range:`/`scope:`/`total_hours`/`entries`/`complete` header and the
   `entries[N]{id,spent_date,user,project,task,hours}` table. Reuse `review`'s
   `--fields` column vocabulary, extended with `rounded_hours` and `billable_rate`.
3. **Wire into dispatch** — add `list` to the `entries` subcommand switch, `ENTRIES_HELP`
   (reads section + an example), and the `KNOWN` flag array from
   [`flag-validation`](flag-validation.md).
4. **Suggestions** — funnel to `entries get <id>`, `--project <name>` to narrow, and
   `review` for the rollup. The export hint gets added by `machine-output`.
5. **Cross-link `review`** — add the `entries list` handoff to `review --by none`'s
   suggestions, per the review spec.

## Validation

- [ ] `entries list` defaults to self / `--since 7d` and returns row-first output with a stamped range header
- [ ] Every filter matches `review`'s behavior over the same window: `--project`, `--client`, `--task`, `--user`, `--team`, `--billable`, `--non-billable`, `--unbilled`, `--approval`
- [ ] `entries list --project X --from A --to B` and `review --project X --from A --to B --by none` return the **same** entry ids — proving the shared builder, not a second implementation
- [ ] `complete: true` on a fully-paginated result; `--limit` cap announced loudly when hit
- [ ] Empty result → definitive empty state with broaden/scope hints
- [ ] `--team --user <id>` rejected here too (inherited from [`review-user-scope`](review-user-scope.md))
- [ ] `--fields rounded_hours,billable_rate` adds those columns
- [ ] `review` output is byte-identical to before the extraction, at every `--by` axis

## Risks / unknowns

- **The extraction is the risk, not the new command.** `review` is the center of gravity
  ([principle](../specs/principles.md#review-is-the-center-of-gravity)) and its query path
  is load-bearing. Pin `review`'s current output with tests *before* extracting, so the
  refactor is provably behavior-preserving.
- **Surface overlap.** Two commands returning the same rows risks agent confusion about
  which to reach for. Mitigated by framing in help text and suggestions (rollup vs batch),
  and by only one of them carrying export flags. Watch whether this actually lands
  cleanly in practice — if agents pick wrong, the fix is sharper help text, not merging
  the commands back together.
- **`--rounded` semantics.** On `review` it swaps the displayed `hours` column. Keep that
  meaning here so the vocabulary stays consistent, even though the machine payload will
  carry both figures regardless.
