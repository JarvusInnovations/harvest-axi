---
status: planned
depends: [flag-validation, entries-list]
specs:
  - specs/behaviors/machine-output.md
  - specs/commands/entries.md
  - specs/commands/invoices.md
  - specs/commands/estimates.md
  - specs/principles.md
issues: [17]
---

# Plan: `--json-out` / `--csv-out` side-channel machine output

## Scope

**In:** `--json-out[=path]` and `--csv-out[=path]` on the two surfaces that earned them —
`entries list` (plus `entries today` / `yesterday` / `get`) and `invoices` (list). Purely
additive: stdout keeps its TOON view and gains `wrote:` / `columns:` / a ready `jq`
line. Bare flag → `0600` file under `$TMPDIR/harvest-axi/`; `=path` persists. Plus
removal of `--raw` from `invoices get` / `estimates get` with a migration hint.

**Out:** export flags on `review` (any axis, including `--by none`), `reports *`,
`budget`, `browse`, and every detail view — no recurring script use case, so they don't
earn the surface. Also out: `--xlsx-out` (add when a use case appears) and any
`--json`-to-stdout mode, ever.

This closes [#17](https://github.com/JarvusInnovations/harvest-axi/issues/17), which
asked for `--json` on stdout. That mechanism was evaluated and rejected org-wide in
[kunchenguid/axi#32](https://github.com/kunchenguid/axi/issues/32); harvest-axi is the
**fourth** implementation of the side-channel pattern after metabase-axi (reference),
otter-axi ([#7](https://github.com/JarvusInnovations/otter-axi/pull/7)), gitsheets-axi
([#222](https://github.com/JarvusInnovations/gitsheets/pull/222)), and hq-axi
([#82](https://github.com/JarvusInnovations/jarvus-hq/pull/82), which removed an existing
`--json` to adopt it). The issue's *analysis* is kept nearly intact — its
script-vs-model test, its scoping, and its insistence on both `hours` and
`rounded_hours` all carry over; only the mechanism changes.

## Implements

- `specs/behaviors/machine-output.md` — the whole spec: flag shape, auto-path + `0600`, one-flag-per-invocation, file-ignores-`--limit`, the three stdout lines, payload shape and TOON field parity.
- `specs/commands/entries.md` / `specs/commands/invoices.md` — the export flags on each surface.
- `specs/commands/estimates.md` / `specs/commands/invoices.md` — `--raw` removal.
- `specs/principles.md` — [Preview to stdout, full data to a file](../specs/principles.md#preview-to-stdout-full-data-to-a-file).

## Approach

1. **`src/output/export.ts`** — port metabase-axi's `src/output.ts` export block
   (`parseExportRequest` / `resolveExportPath` / `performExport`), which is the reference
   implementation:
   - `parseExportRequest` — at most one `*-out`; two is a `VALIDATION_ERROR`.
   - `resolveExportPath` — explicit path (with `~` expansion) or
     `join(tmpdir(), "harvest-axi", "<stamp>-<kind>.<ext>")`. **OS temp dir, not
     `~/.config`** — metabase shipped it under `~/.config` first and had to fix it;
     an auto export is ephemeral scratch and nothing prunes `~/.config`.
   - `performExport` — `mkdirSync` + write, `0600` **only** when the path was
     auto-generated (an explicit path is the caller's business, default umask).
   - Returns `{path, wrote, columns, helpLine}` for the caller to append.
2. **CSV serialization** — needs a dependency (`csv-stringify`, as gitsheets used). Flat
   projection: nested `project`/`task`/`client`/`user` become `<name>` plus `<name>_id`.
   Install via `bun add` and commit that change separately, per the package-manager rule.
3. **Payload builders** — one per surface, in the command module:
   - entries → `{entries: [...]}` with the full record from the spec, carrying **both**
     `hours` and `rounded_hours` regardless of `--rounded`.
   - invoices → `{invoices: [...]}` with the full record from the spec.
   Keys match TOON column names wherever both show the same datum (the parity rule hq
   adopted); nested entities keep `{id, name}` in JSON.
4. **The file ignores `--limit`.** `paginateAll` already fetches everything; the cap is
   applied at render. Export from the **pre-cap** array — the single easiest thing to get
   wrong here, and silently truncating a script's data is the failure mode the whole
   feature exists to avoid.
5. **`jq` help line must be runnable as-is** against the payload shape — e.g.
   `jq '[.entries[] | select(.billable)] | map(.rounded_hours) | add' <path>`. Test by
   executing it, not by eyeballing it.
6. **Remove `--raw`** from `invoices.ts:281` / `estimates.ts:256` and their help text
   (`invoices.ts:24`, `estimates.ts:24`, which currently advertise JSON while rendering
   TOON). Add `raw` and `json` to `REMOVED_FLAG_HINTS`/`RENAMED_FLAG_HINTS` from
   [`flag-validation`](flag-validation.md). Two comments also reference `--raw` as an
   escape hatch (`invoices.ts:732`, `estimates.ts:550`) — update both.
7. **Add the flags to the globals list** in the validation layer, and reject them with a
   targeted message on non-exporting commands — accepted-but-inert is the silent drop
   this repo is trying to eliminate.
8. **README + help text** — document the pattern once and link the surfaces to it.

## Validation

- [ ] `entries list --json-out` prints the normal TOON **unchanged**, plus `wrote:` / `columns:` / `help[]`; the file holds the full payload at mode `0600`
- [ ] stdout with and without `--json-out` is byte-identical apart from the three appended lines (diff-tested, not eyeballed)
- [ ] `--json-out=/explicit/path.json` writes exactly there, with the default umask
- [ ] The printed `jq` example **executes successfully** against the file just written, for both entries and invoices
- [ ] `entries list --limit 5 --json-out` shows 5 rows on stdout and every matched entry in the file
- [ ] Entry payloads carry both `hours` and `rounded_hours`, and both `{id, name}` for nested entities; `--rounded` changes the display column but not the payload
- [ ] `invoices --json-out` payload sums to the same total the TOON header reports
- [ ] `--csv-out` opens cleanly in a spreadsheet; nested entities appear as name + `_id` columns
- [ ] `--json-out --csv-out` together exits 2
- [ ] `invoices 123 --raw` and `entries list --json` exit 2 with targeted hints naming `--json-out`
- [ ] `review --by none --json-out` is **rejected** with a message pointing at `entries list`
- [ ] Auto-path files land under `$TMPDIR/harvest-axi/`, never `~/.config/harvest-axi`

## Risks / unknowns

- **Sensitive data at rest.** Payloads carry `billable_rate`, `cost_rate`, and client
  names. `0600` covers the auto path; an explicit path is the caller's call. Worth a note
  in the README rather than leaving it implicit.
- **CSV flattening is lossy by nature.** Line items and nested entities don't round-trip.
  Frame CSV as reporting-only in help text; JSON is the round-trippable format (the
  distinction gitsheets #222 drew).
- **`entries get` is a single record**, so its payload is an object, not an array. Decide
  whether it wraps as `{entry: {...}}` (consistent with the detail view) or a one-element
  array (consistent with the batch payloads, so one `jq` idiom works for both). Lean
  one-element array for `jq` uniformity; confirm against the help-line test.
- **Timestamp in auto-paths** must be filesystem-safe on every platform — metabase
  replaces `:` and `.` in the ISO string for exactly this reason.
