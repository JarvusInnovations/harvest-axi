---
status: done
depends: []
specs:
  - specs/commands/invoices.md
issues: []
---

# Plan: `invoices pdf <id>` — download the invoice PDF

## Scope

**In:** a single-invoice download verb, `invoices pdf <id> [--out=<path>]`, fetching the
public `client_key` PDF URL and writing it to disk; plus the one `help[]` hint on
`invoices get` that makes it discoverable.

**Out:** a batch form (`invoices pdf --last-month --out-dir=…`), and the identical verb
for `estimates`. Both are plausible and neither has demonstrated demand — the
earned-not-uniform rule. Also out: any change to what `invoices get` renders beyond
appending the hint.

## Motivation

`invoices get` already composes the `web` and `pdf` URLs from `client_key`
(`invoices.ts:437-441`), so the *data* has been there since the invoices-read plan. What
was missing is everything around it: no verb to fetch the file, and no hint that the
`links` block is actionable — it sits between `lifecycle` and `line_items` as inert text
in a view that deliberately emits no suggestions. The agent's only recourse was to notice
the URL, shell out to `curl`, and invent a filename.

## Implements

- `specs/commands/invoices.md` — the `invoices pdf` section (auto vs `=path`, `0600`, the `wrote:` confirmation, the `base_uri` and `client_key` failure modes, read-only justification) and the amendment allowing this view its single suggestion.

## Approach

1. **`invoicePdf(id, rest)`** in `src/commands/invoices.ts`:
   - Validate flags against `["--out"]` via `rejectUnknownFlag`; reuse the export layer's
     `=`-form rule so `--out /path` names the attached form rather than surfacing a stray
     positional. Extract that check out of `parseExportRequest` into a small shared helper
     rather than copying the heuristic — copying a rule is exactly what caused #19.
   - `GET invoices/{id}` for `client_key`, `number`, `client`, `amount`. Fail with the
     existing `auth whoami --refresh` remedy when `base_uri` is uncached, and with a
     distinct message when the invoice has no `client_key`.
   - Fetch the PDF with a **plain `fetch`**, not `harvestRequest` — the client_key URL is
     a public endpoint on a different host path that takes no auth headers, and routing it
     through the authed JSON client would both send credentials it doesn't need and try to
     parse a binary body as JSON.
   - Write via the export layer's path resolution so `~`/relative/absolute all behave as
     they do for `--json-out`; `0600` on the auto path.
2. **Default filename** `invoice-<number>-<id>.pdf`, sanitized — invoice numbers are
   free-text in Harvest and can contain `/` or spaces.
3. **The hint** on `invoices get`, emitted only when the `links` block resolved, since a
   hint pointing at a command that will fail on missing `base_uri` is worse than none.
4. Wire into dispatch, `INVOICES_HELP`, and the README.

## Validation

- [x] `invoices pdf <id>` writes a real PDF (`%PDF` magic bytes) to an auto path under the OS temp dir at mode `0600`
- [x] `--out=<path>` writes exactly there, with `~` and relative paths resolved like the export flags
- [x] stdout reports `wrote:` with a byte count, plus invoice number / client / amount
- [x] `invoices pdf <id> --out /tmp/x.pdf` (space form) names the `=` form
- [x] An uncached `base_uri` fails with the `auth whoami --refresh` remedy and no fetch of the PDF
- [x] An invoice without `client_key` fails naming that, distinctly from the `base_uri` case
- [x] The PDF fetch carries **no** `Authorization` header (public URL; credentials must not leak to it)
- [x] `invoices get <id>` emits the `pdf` hint when links resolved, and omits it when they didn't
- [x] `invoices pdf` with no id, and with an unknown flag, both fail before any network call
- [x] A non-2xx from the public URL is translated, not surfaced as raw fetch noise

## Risks / unknowns

- **The public URL is an unauthenticated bearer secret.** Anyone with the `client_key`
  link can read the invoice, which is why the auto-path file is `0600` and why the README
  should say so. It also means a wrong id silently yields *someone else's* invoice if the
  key happens to be valid — but keys are per-invoice and unguessable, so the practical
  risk is low; the `wrote:` line echoing number/client is the check.
- **`base_uri` comes from the profile cache**, which a fresh install may not have
  populated. The failure must name `auth whoami --refresh` rather than 404ing against a
  guessed host.
- **Harvest may serve an HTML error page with a 200** for a stale key. Verify the magic
  bytes rather than trusting the status code, and translate a non-PDF body.

## Notes

- **A `--out=<path>` bug the plan's own validation list caught.** `normalizeArgs`
  splits `--name=value` for every flag *except* a registry of attached-value flags,
  and `--out` wasn't in it — so `--out=/tmp/x.pdf` was split and then rejected as if
  it were the space form. Renamed the set `ATTACHED_VALUE_FLAGS` and documented that
  any new file-destination flag must be added, since omitting it fails in this
  non-obvious way.
- **The `=`-form guard is shared, not copied.** Extracted `assertAttachedValueForm`
  out of `parseExportRequest` so `--out` and the export flags enforce one rule —
  copying this class of check is precisely what caused #19 a few hours earlier.
- Bare `--out` differs from bare `--json-out`: there is no auto-path meaning, you
  simply omit the flag. The error says so rather than suggesting a form that doesn't
  exist.
- **Trust the bytes, not the status.** A stale `client_key` can return an HTML error
  page with a 200, so the handler checks for `%PDF` magic bytes. Pinned by a test.
- The PDF fetch deliberately bypasses `harvestRequest` — the public URL needs no
  credentials, and routing it through the authed JSON client would both leak a token
  where it isn't wanted and try to JSON-parse a binary body. A test asserts no
  `Authorization` header reaches that URL.
- Live-verified: 30,975-byte real PDF (`file` confirms v1.4, 1 page) at mode 0600,
  `--out=` and `~` expansion both correct, and the `invoices get` hint appearing only
  when links resolved.
- 272 tests (+12).

## Follow-ups

- **Batch download** (`invoices pdf --last-month --out-dir=…`) remains unbuilt. It is
  the likelier real workflow — "grab all of last month's invoices" — but no demand has
  surfaced yet; revisit if a second request appears.
- **`estimates pdf`** — the identical `client_key` mechanism exists on estimates
  (`/client/estimates/{key}.pdf`). Same earned-not-uniform reasoning; the shared
  helpers make it a small addition when wanted.
