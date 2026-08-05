---
status: done
depends: [flag-validation]
specs:
  - specs/commands/review.md
  - specs/behaviors/flag-validation.md
issues: [14]
---

# Plan: `review --user` must never be silently discarded (#14)

## Scope

**In:** make `--team` and `--user` mutually exclusive on `review` (and on the new
`entries list`, once it exists), rejecting the pair with a `VALIDATION_ERROR` instead of
letting `--team` silently win. Plus an error — not a silent unfiltered result — for an
unresolvable `--user`.

**Out:** name resolution improvements for `--user` (already working via `resolveEntity`),
and any change to what `--team` alone does.

## Implements

- `specs/commands/review.md` — the **Scope resolution** section: exactly one user scope, flags mutually exclusive rather than precedence-ordered.
- `specs/behaviors/flag-validation.md` — the contradictory-flags rule, of which `--team` + `--user` is the motivating case.

## Approach

The bug is *not* what [#14](https://github.com/JarvusInnovations/harvest-axi/issues/14)
first suggests — it is not the CLI-wide silent-flag-drop, and unknown-flag validation
alone will not close it. `--user` is parsed (`review.ts:89`), resolved (`review.ts:208`),
and wired into the query (`review.ts:216`). The defect is precedence at `review.ts:213`
(line numbers against `develop`):

```js
if (flags.team) {           // --team wins unconditionally
  scopeParts.push("team");
} else if (user) {          // --user never reached when both are passed
  query.user_id = user.id;
```

Every repro in the issue passes `--team --user <id>` together, so `--user` is discarded
and whole-team totals come back under a single-user label.

1. Validate the combination **before** the resolve calls (which cost an API round trip):
   if `flags.team && flags.user`, throw with both flags named and two concrete
   alternatives — `--user <id>` alone, or `--team --by user` for a per-user breakdown.
2. Leave the `if/else if` chain otherwise intact; with the pair rejected upstream, its
   precedence is no longer reachable.
3. Confirm an unresolvable `--user` already errors rather than falling through to an
   unfiltered query — `resolveEntity` should throw, but the issue's silent-wrong
   character warrants an explicit test rather than an assumption.
4. Apply the same guard to `entries list` when [`entries-list`](entries-list.md) lands
   (it inherits review's scope vocabulary). Whichever plan lands second wires the second
   call site.

## Validation

- [x] `review --team --user <id>` exits 2 naming both flags and suggesting both alternatives — no API call made
- [x] `review --user <id> --from … --to …` returns only that user's entries; three distinct ids return three distinct totals (the issue's exact repro, inverted)
- [x] Those per-user totals sum to the `--team` total over the same window
- [x] `review --user <unknown-name>` errors naming the unmatched value; it never returns an unfiltered result
- [x] `--team` alone and `--user` alone are both unchanged from today
- [x] Regression test pinning the #14 repro shape so precedence can't silently return

## Risks / unknowns

- **Someone may be passing `--team --user` today** and reading the (wrong) team totals as
  if they were intentional. That's the bug, so breaking it is correct — but it turns a
  silent-wrong into a hard error for any script doing it, which is worth calling out in
  the release notes rather than burying.
- **Scope-label drift.** `scopeParts` builds the header's `scope:` string; confirm the
  single-user path stamps `user <name>` so the window/scope echo stays honest per
  [Human time in, stamped range out](../specs/principles.md#human-time-in-stamped-range-out).

## Notes

- **The issue's framing was wrong and the plan records why**, since it would
  otherwise be re-litigated: #14 reads like the CLI-wide silent-flag-drop, but
  `--user` was parsed, resolved, *and* wired into the query. Only precedence was
  broken. Unknown-flag validation (`flag-validation`) does not close this.
- `assertUserScope` lives in `src/harvest/entry-query.ts` rather than
  `review.ts`, so `entries list` inherits the same guard instead of
  reimplementing it — the same anti-drift reasoning as the shared query builder.
- Also corrected `--user`'s help text, which still said name resolution was
  unimplemented; `resolveEntity` has handled it since the browse plan.
- 5 regression tests pin the repro shape, including three distinct user ids
  returning three distinct totals (previously all identical).

## Follow-ups

- **Release notes** must call out that `--team --user` now hard-errors. Anyone
  passing both today is silently getting team totals; the fix is correct but
  visible.
