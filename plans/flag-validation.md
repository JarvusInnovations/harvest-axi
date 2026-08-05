---
status: done
depends: []
specs:
  - specs/behaviors/flag-validation.md
  - specs/principles.md
issues: []
---

# Plan: Fail loud on unrecognized flags (CLI-wide)

## Scope

**In:** a shared arg layer (`src/cli/args.ts`) providing `--name=value` normalization,
per-subcommand known-flag validation, and targeted renamed/removed migration hints —
wired into **every** command's flag parsing. Unknown flags become `VALIDATION_ERROR`
(exit 2) instead of being silently dropped.

**Out:** the `--team`/`--user` contradiction (that's [`review-user-scope`](review-user-scope.md),
which consumes this plan's rejection helper) and the export flags themselves (that's
[`machine-output`](machine-output.md), which consumes this plan's hint tables). This plan
lands the mechanism and the sweep; those two land the policies that use it.

This is foundational: both downstream plans need a validation layer to hang behavior on,
and shipping either without it means an agent's typo silently no-ops.

## Implements

- `specs/behaviors/flag-validation.md` — the whole spec: unknown-flag rejection, per-subcommand flag sets, globals, named-window handling, renamed/removed hint tables, bare-legacy-flag parsing, constrained value validation.
- `specs/principles.md` — [Fail loud on unrecognized input](../specs/principles.md#fail-loud-on-unrecognized-input).

## Approach

Today every command hand-rolls a `switch`-based `parseFlags` whose `default:` branch
silently `break`s (`entries.ts:83`, `review.ts:141`). Two viable shapes: rewrite all
parsers onto a shared `parseArgs` (jarvus-hq's shape), or keep the switches and make
their `default:` branch throw. **Take the second** — it touches far less shipped parsing
logic per command and keeps each command's flag semantics where they already live.

1. **`src/cli/args.ts`** — port the proven pieces from `jarvus-hq/src/cli/args.ts`:
   - `splitFlagToken(arg)` → `{name, value?}`, handling `--name=value`. This is what lets
     an optional-value flag work both bare and with `=path`, and it must run *before* the
     switch so `--json-out=/tmp/x.json` matches `case "--json-out"`.
   - `rejectUnknownFlag(name, known, command)` → throws `AxiError(VALIDATION_ERROR)` with
     the valid-flags list inline (per spec, so the agent self-corrects in one turn).
   - `rejectUnknownPositional(value, command)` — same shape, for stray positionals.
   - `RENAMED_FLAG_HINTS` / `REMOVED_FLAG_HINTS` tables, checked before the generic list.
     Seed with `--raw` and `--json` (both consumed by `machine-output`).
   - Any flag in either hint table parses **bare** — a value-demanding parser crashes on
     `--raw` before validation runs and the hint never fires. This bit was an unplanned
     fix in hq's implementation; inherit it rather than rediscover it.
2. **Sweep all nine command files** — each `parseFlags` gets a `KNOWN` array; the
   `default:` branch calls `rejectUnknownFlag`. `review.ts:141`'s default currently also
   handles named windows: keep that check first, then reject. Verify every named window
   in `NAMED_WINDOWS` is reachable on every command that takes a range. Note `entries.ts`
   has **two** switches (`:83` flag parsing, `:124` dispatch) — both need the treatment.
3. **Per-subcommand sets** — `entries`, `invoices`, `estimates`, `browse`, `auth`, and
   `setup` dispatch to subcommands with different flags. Validate against the
   *subcommand's* set, after dispatch resolves.
4. **Constrained values** — extend the `--by` treatment (already correct at
   `review.ts:93`) to `--approval` and `--state`.
5. **Non-flag positionals** — an unexpected positional is also silently dropped today;
   reject with the same shape. Watch `entries get <id>` / `invoices get <id>`, which do
   take one.

## Validation

- [x] `harvest-axi review --stat closed` exits 2 naming `--stat` and listing review's valid flags inline
- [x] Every named window (`--today` … `--last-month`) still resolves on `review`, `entries`, `invoices`, `estimates`, `reports` — no regression from the new `default:` branch
- [x] `harvest-axi entries log --projekt X` is rejected against `log`'s subcommand flag set, not a merged `entries` set
- [x] `--json-out=/tmp/x.json` and bare `--json-out` both parse to the same flag name (`=` normalization proven by unit test)
- [x] A bare legacy flag with no trailing value (`harvest-axi invoices 123 --raw`) reaches its migration hint rather than crashing in the parser
- [x] `--approval bogus` and `--state bogus` list their valid vocabularies
- [x] `--help` passes on every command and subcommand, never reported unknown
- [x] Full suite green; no command's `default:` branch silently `break`s on a `--` token

## Risks / unknowns

- **Regression surface is every command.** A flag that's parsed today but missing from a
  `KNOWN` array becomes a hard error — a strictly worse failure than the silent drop, and
  it'll hit real usage immediately. Build each `KNOWN` array from the command's `--help`
  text *and* its switch cases, and diff the two: any flag in one but not the other is
  already a bug worth reporting.
- **Undocumented flags in the wild.** Some flags may be handled in the switch but absent
  from `--help`. Those are the ones most likely to be missed; the diff above is the guard.
- **Ordering with `machine-output`.** Both edit every `parseFlags`. Land this first; the
  export plan then adds two entries to already-existing `KNOWN` arrays.

## Notes

- **Kept the switch parsers** rather than porting hq's shared `parseArgs`, as
  planned. `normalizeArgs` splits `--name=value` *except* for the export flags:
  splitting those would make `--json-out=path` indistinguishable from
  `--json-out path`, and the space form must stay invalid so it can't swallow a
  positional. They're stripped upstream by `parseExportRequest` instead.
- **`--raw` removal landed here, not in `machine-output`.** The removed-flag
  hint table lives in this plan, and a half-state (table says removed, code
  still honors it) is worse than either end state. Found by a test:
  `invoices get --raw` bypassed `parseListFlags` entirely because
  `invoiceDetail` read `rest.includes("--raw")` itself, so the hint never fired
  and the command hit the network.
- **`src/output/export.ts` was committed here** though it belongs to
  `machine-output` — inert (nothing imported it) until that plan wired it up.
- `auth` needed a second guard beyond the `default:` branch: `--token` is a real
  case in the shared switch, so `auth whoami --token x` parsed fine and had to
  be rejected against the *subcommand's* set afterward.
- `reports expenses <axis>` takes a positional, so `parseReportsFlags` collects
  positionals and the dispatcher rejects them for every report type but that one.
- 202 tests (+32): `test/cli/args.test.ts` (11 unit) and
  `test/cli/flag-validation.test.ts` (20 command-level, each asserting `fetch`
  was never called).

## Follow-ups

- None. The `--help`-vs-switch flag diff called for in the risks turned up no
  undocumented flags — every switch case was already in its help text.
