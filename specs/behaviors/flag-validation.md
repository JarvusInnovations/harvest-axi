# Behavior: Flag validation

## Rule

Every command validates its flags **before any Harvest API call** and rejects anything
it does not recognize with a `VALIDATION_ERROR` (exit 2). No flag is ever silently
dropped, and no two contradictory flags are ever silently reconciled by precedence.

## Applies To

Every command and subcommand: `review`, `entries` (all subcommands), `browse`,
`reports`, `invoices`, `estimates`, `auth`, `doctor`, `setup`, and the home view.

## Details

### Unknown flags

An unrecognized flag names itself and lists the command's valid flags inline, so the
agent self-corrects in one turn rather than spending a round trip on `--help`:

```
error: Unknown flag --stat for `review`
help[2]:
  Valid flags: --since, --from, --to, --team, --user, --project, --client, --task, --billable, --non-billable, --unbilled, --approval, --by, --rounded, --limit, --fields
  Global flags --help, --json-out, --csv-out are always allowed
```

Validation happens **per subcommand**, not per top-level command — `entries list` and
`entries log` accept different flags, and only the subcommand layer knows which is in
play.

### Globals

`--help`, `--json-out`, and `--csv-out` are accepted on every command's flag list and
are never reported as unknown. The export flags are *accepted* globally but only *act*
on the surfaces listed in [machine-output](machine-output.md); elsewhere they are
rejected with a targeted message naming the commands that do export, rather than
silently doing nothing.

### Named windows

The named time-window flags (`--today`, `--yesterday`, `--this-week`, `--last-week`,
`--this-month`, `--last-month`, …) are real flags on every command that accepts a date
range, and validate as such. They must not fall through an unknown-flag branch.

### Renamed / removed flags

A flag that once existed gets a **targeted migration hint** naming its replacement, not
the generic valid-flags list — one step to self-correct instead of a search:

| Old | Message |
| --- | --- |
| `--raw` | `--raw was replaced by --json-out[=path] — it claimed to emit JSON but rendered TOON. --json-out writes real JSON to a file; stdout keeps the normal detail view.` |
| `--json` | `--json was replaced by --json-out[=path], which writes the full payload to a file additively — stdout keeps the normal TOON view.` |

`--json` never shipped in harvest-axi; its hint exists because it is the flag an agent
carrying habits from other CLIs will reach for first, and a targeted hint costs one
table row.

A bare legacy flag (`--raw` with no trailing value) must be safe to parse. A parser that
demands a value for every non-boolean flag crashes on `--raw` *before* validation runs,
so the migration hint never fires for the common trailing-flag case. Any flag present in
the renamed/removed tables parses bare; its value is discarded, since validation rejects
it outright either way.

### Contradictory flags

Two flags whose meanings conflict are rejected, never silently ordered:

- **`--team` with `--user <id>`** — `--team` means "all users", `--user` means "this
  one". Reject with a message naming both and pointing at `--user` alone for a single
  user, or `--team --by user` for a per-user breakdown. Silently letting `--team` win
  returns whole-team totals under a single-user label, which is
  [#14](https://github.com/JarvusInnovations/harvest-axi/issues/14).
- **`--billable` with `--non-billable`** — mutually exclusive; the pair matches nothing.
- **Two export flags** — see [machine-output](machine-output.md).

### Flag values

A flag that takes a constrained value validates that value against the allowed set and
lists the set on failure — the treatment `--by` already gets. This extends to
`--approval` (`unsubmitted|submitted|approved`) and `--state`
(`draft|open|paid|closed`).

An unresolvable `--user`/`--project`/`--client`/`--task` reference is an error naming
the unmatched value, never a silently unfiltered result.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Fail loud on unrecognized input](../principles.md#fail-loud-on-unrecognized-input)
  — this behavior is its implementation.
- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise)
  — validation errors reference `harvest-axi` flags, never Harvest query parameters.
