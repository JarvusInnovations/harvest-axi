---
status: done
depends: []
specs:
  - specs/behaviors/flag-validation.md
  - specs/behaviors/machine-output.md
issues: [19]
---

# Plan: Export-flag recognition is consistent and self-consistent (#19)

## Scope

**In:** the defect reported by the first external user of v1.7.0
([#19](https://github.com/JarvusInnovations/harvest-axi/issues/19)), which is one bug
with two faces:

1. The unknown-flag suggestion advertises `--json-out` / `--csv-out` as "always
   allowed" on commands that reject them — self-contradictory, and an agent believes
   it and retries the same call.
2. `--json-out=<path>` on a non-exporting command falls through to the generic
   unknown-flag path instead of the targeted redirect that the **bare** form correctly
   gets. So the fix for #17's `--json` (a helpful pointer at `entries list`) regressed
   for its own replacement.

Plus the reporter's explicitly-low-priority nit, folded in because it is a few lines
and the spec now requires it:

1. The space form `--json-out <path>` fails as a stray positional with no hint that the
   value must be attached with `=`.

**Out:** adding export support to `review` / `reports` / `budget`. #19 offers "pick
one" — wire it on `review`, or make the message honest. We pick **honest message**: the
earned-not-uniform rule in
[machine-output](../specs/behaviors/machine-output.md#applies-to) holds, and the data
the reporter wanted is available row-level from `entries list` with the same filters,
which is exactly what the restored redirect points them to.

Also out: the reporter's original point 4 (bare `--json-out` destination), **retracted
in the edited issue** and confirmed working on the shipped binary.

## Implements

- `specs/behaviors/flag-validation.md` — the rewritten **Globals** section (`--help` is the only universal flag; export flags are *recognized* everywhere but *supported* only on export surfaces; matching is by flag name, not raw token) and the new suggestion-truthfulness rule.
- `specs/behaviors/machine-output.md` — the space-form error contract, and the reworded recognized-vs-supported bullet.

## Approach

The root cause of (1) is a **duplicated equality test**. `normalizeArgs` deliberately
leaves `--json-out=path` intact so the `=` form stays distinguishable from the space
form, but nine call sites classify with `arg === "--json-out"`, which the attached form
fails. Nine copies of a rule is why it drifted; the fix is to delete all nine rather
than repair them.

1. **Centralize into `rejectUnknownFlag`.** It already receives the flag and the command
   name, and it is the single funnel every unknown flag reaches. Split the token on `=`
   first, then classify by name: export flag → `rejectInertExportFlag`; renamed/removed →
   targeted hint; otherwise → the generic list. Delete the nine call-site checks
   (`review.ts`, `reports.ts`, `browse.ts`, `auth.ts`, `estimates.ts` ×3, `invoices.ts` ×2).
2. **Make the globals line honest.** Replace the fixed
   `Global flags --help, --json-out, --csv-out are always allowed` with `--help is always
   allowed`, plus — only for export-capable commands — a line naming the export flags.
   Add an `exports?: boolean` option to `rejectUnknownFlag`; `entries list|today|
   yesterday|get` and `invoices` pass it.
3. **Name the `=` form when the space form is used.** In `parseExportRequest`, when a
   bare export flag is immediately followed by a **path-like** token, throw naming the
   attached form. Path-like is deliberately narrow — contains `/` or ends in
   `.json`/`.csv`/`.tsv` — so `entries get --json-out 123` (a bare id) does *not*
   false-positive into a confusing error; only something that is obviously a path does.
   The reporter marked this low priority and agrees the constraint itself is right; only
   the error text changes.
4. **Regression-test the whole matrix**, since the bug was precisely that one form of one
   flag took a different path: {bare, `=path`} × {export surface, non-export command}.

## Validation

- [x] `review --json-out=/tmp/x.json` gives the same targeted redirect as bare `--json-out`, naming `entries list` / `invoices`
- [x] The same holds on `reports`, `estimates`, `browse`, and the `invoices get` / `estimates get` detail views, for both `--json-out` and `--csv-out`
- [x] No unknown-flag error anywhere advertises a flag that same command rejects
- [x] `review --stat x` still lists review's valid flags and says `--help is always allowed` — with no mention of export flags
- [x] `entries list --bogus` lists its valid flags *and* mentions the export flags it genuinely supports
- [x] `entries list --json-out /tmp/y.json` names the `=` form rather than reporting a stray positional
- [x] `entries get --json-out 123` is **not** mistaken for the space form (bare id is not path-like)
- [x] Every previously-working invocation is unchanged: bare and `=path` exports on all five surfaces still write, report, and pass the `jq` line
- [x] Zero remaining `=== "--json-out"` equality tests in `src/commands/`

## Risks / unknowns

- **The path-like heuristic is a judgment call.** It cannot be perfect: `--json-out out`
  (no slash, no extension) still reads as a stray positional. That is the acceptable
  failure — it errors rather than silently writing to the wrong place, and the narrow
  heuristic is what keeps the legitimate `entries get --json-out 123` working. Revisit
  only if a real report shows the gap matters.
- **Centralizing changes error text on paths not covered by #19.** Every unknown-flag
  message loses the export-flags line unless the command exports. That is the point, but
  it touches existing tests, which should be updated to assert the *new* contract rather
  than loosened.

## Notes

- **Root cause was nine copies of one rule.** `normalizeArgs` deliberately leaves
  `--json-out=path` intact so the `=` form stays distinguishable from the space
  form, but nine call sites classified with `arg === "--json-out"` — an equality
  test the attached form fails. Fixed by deleting all nine and classifying inside
  `rejectUnknownFlag`, which every unknown flag already funnels through. The new
  `flagName()` split runs before any classification, so no future branch can see a
  raw token again.
- **The spec was wrong first, and the code faithfully implemented it.** The old
  Globals section said export flags were "accepted on every command's flag list and
  never reported as unknown" *and* "elsewhere they are rejected" — both can't hold.
  Rewritten around recognized-everywhere vs supported-on-export-surfaces, plus a new
  rule that every suggestion must be true of the command printing it.
- **Kept the surface narrow.** #19 offered "wire `--json-out` on `review`, or fix the
  message". Chose the message: the earned-not-uniform rule holds, and the reporter's
  data is available row-level from `entries list` with identical filters — which the
  restored redirect now points at from both flag forms.
- The space-form heuristic only fires on a **path-like** follower (contains `/` or
  ends `.json`/`.csv`/`.tsv`), so `entries get --json-out 123` keeps working. Verified
  live and pinned by a test.
- 260 tests (+21), including the full {bare, `=path`, `--csv-out=path`} ×
  six-non-exporting-commands matrix — the shape of the bug was one form taking a
  different path, so the matrix is the regression surface.

## Follow-ups

- None. Reporter's point 4 was retracted in the edited issue and re-verified working.
