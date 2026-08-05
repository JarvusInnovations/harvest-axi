# Behavior: Machine output (side-channel export)

## Rule

A command that carries an earned machine-output flag returns **two things from one
invocation**: the usual agent-readable TOON on **stdout**, and — only when an
explicit `--<fmt>-out` flag is passed — the **full payload written to a file**.

Writing a file **never changes stdout**. The TOON view is byte-identical with and
without the flag, apart from the appended `wrote:` / `columns:` / `help[]` lines that
describe the file. There is no `--json`-to-stdout mode and never will be.

## Applies To

Machine-output flags are **earned, not uniform**. A command gets one only when a
script consumes it often, doing deterministic multi-row work a model should not do by
hand. As of this spec, exactly two surfaces qualify:

| Surface | Recurring script use case |
| --- | --- |
| `entries list` (+ `entries today` / `yesterday` / `get`) | Turning tracked time into invoice / progress-report line items: group by task, sum `rounded_hours`, × rate, subtotal. |
| `invoices list` | Summing prior invoices for cumulative invoiced-to-date and remaining budget. |

**Deliberately excluded** — `review` (all axes, including `--by none`), `reports *`,
`budget`, and every detail view. These are agent-read: a model lifts a scalar or a
narrative straight out of the TOON. No recurring script consumes them, so they do not
earn the surface. `review` keeps its rollups and its `--by none` raw rows as a *reading*
surface; the batch a script needs is `entries list`.

Adding a flag to a new command requires naming the recurring use case, per
[Preview to stdout, full data to a file](../principles.md#preview-to-stdout-full-data-to-a-file).

## Details

### Flags

Format is chosen by an **explicit per-format flag**. No generic `--out`, no extension
inference, no `--format` selector — the flag names the format outright:

- **`--json-out[=<path>]`** — the full payload as JSON.
- **`--csv-out[=<path>]`** — the full payload flattened to CSV, for spreadsheet
  hand-off. Lossy by nature (nested objects flatten to their display name).

Rules common to both:

- The `=<path>` is **optional**, and the `=` form is required for an explicit path —
  `--json-out <path>` must not be accepted, because a space-separated value would
  swallow a positional (`entries get <id> --json-out` has one).
- **The space form must fail by naming the `=` form**, not by surfacing the path as a
  stray positional. `--json-out /tmp/x.json` reports that the value must be attached and
  shows `--json-out=/tmp/x.json`. A constraint the tool enforces but never explains is
  indistinguishable from a bug to the caller — an `Unexpected argument "/tmp/x.json"`
  gives an agent nothing to correct toward.
- Bare flag → auto-generate `<os-temp-dir>/harvest-axi/<UTC-timestamp>-<kind>.<ext>`.
  An auto export is **ephemeral scratch**, so it belongs in the OS temp dir, which the
  OS prunes — never under `~/.config/harvest-axi`, which nothing prunes and which would
  grow unbounded.
- **Auto-generated files are written `0600`.** Time entries and invoices carry billing
  rates and client names, and the OS temp dir is world-readable on some platforms. An
  explicit path is the caller's responsibility and is written with the default umask.
- At most **one** export flag per invocation; combining them is a `VALIDATION_ERROR`
  (exit 2).
- Export flags are **recognized everywhere but supported only on the surfaces above**.
  On any other command they are rejected with a targeted redirect naming these surfaces
  — never silently ignored (an accepted-but-inert flag is the silent-drop failure
  [flag-validation](flag-validation.md) exists to prevent), and never with a bare
  "unknown flag" (they are not typos). Both the bare and `=path` forms get that same
  redirect. Commands outside the table must not advertise these flags in their
  valid-flags line.

### The file ignores display caps

stdout stays capped (`--limit`, default 200, announced loudly per
[Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap)).
The **file always carries every record the query matched**, regardless of `--limit`.
A script asking for the full set must not be silently truncated by a display concern.

### What stdout gains on write

Three additions, so the agent can compose follow-up processing **without opening the
file first**:

```
wrote: /tmp/harvest-axi/2026-08-05T14-22-01-entries.json (847 rows)
columns: id, spent_date, user, project, task, hours, rounded_hours, billable, is_billed, billable_rate, notes
help[1]: Run `jq '[.entries[] | select(.billable)] | map(.rounded_hours) | add' /tmp/harvest-axi/…-entries.json` to total billable hours
```

- `wrote:` — path and row count.
- `columns:` — the payload's field names.
- `help[]` — a **ready-to-run** example against the written path: `jq` for JSON, a
  `head` / spreadsheet hint for CSV. It must run as-is against the file just written.

### Payload shape

- **Field parity with TOON.** A payload key matches its TOON column name wherever the
  same datum appears in both. The machine payload is a *superset*: it carries the full
  enriched record even where TOON shows a minimal schema.
- **Nested entities carry both parts.** Where TOON flattens `project` to a display
  name, JSON keeps `{"id": …, "name": …}` so a script can group by a stable id rather
  than a name that may collide. CSV, being flat, gets the name and an `_id` column.
- **Entry payloads carry `hours` *and* `rounded_hours`.** A billing script mirrors how
  Harvest actually bills, so it needs the rounded figure without re-deriving the
  account's rounding rule. `review --rounded` picks one for display; the machine payload
  never forces that choice.
- Entry records carry: `id, spent_date, user, project, task, client, hours,
  rounded_hours, billable, is_billed, is_running, billable_rate, cost_rate, notes`.
- Invoice records carry: `id, number, amount, due_amount, currency, issue_date,
  due_date, state, sent_at, paid_at, paid_date, paid_amount, client, project`.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Preview to stdout, full data to a file](../principles.md#preview-to-stdout-full-data-to-a-file)
  — this behavior is its implementation, including the earned-not-uniform rule that
  fixes the Applies-To table above.
- [Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap)
  — why the file ignores `--limit` while stdout announces it.
- [Fail loud on unrecognized input](../principles.md#fail-loud-on-unrecognized-input)
  — why two export flags at once is an error, and why an export flag on a
  non-exporting command is rejected rather than ignored.
