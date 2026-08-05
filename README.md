<h1 align="center">harvest-axi</h1>

<p align="center">An <a href="https://axi.md">AXI</a>-compliant CLI for <a href="https://www.getharvest.com/">Harvest</a> time tracking — built for agents.</p>

`harvest-axi` wraps the [Harvest API v2](https://help.getharvest.com/api-v2/) in an agent-ergonomic CLI: token-efficient [TOON](https://toonformat.dev/) output, human date ranges in / year-stamped ranges out, paginate-to-completion reads, and idempotent timesheet edits.

Its headline workflow is **period-based time-entry review** — for yourself, your whole team, a project, or a client — modeled on the "catch-up" pattern from [slack-axi](https://github.com/JarvusInnovations/slack-axi).

## Setup

```sh
harvest-axi auth setup --token <personal-access-token>
```

Mint a Personal Access Token at <https://id.getharvest.com/developers>. The account id is auto-selected when your token sees exactly one Harvest account (otherwise pass `--account <id>`). Credentials are stored in `~/.config/harvest-axi/config.json`; `HARVEST_ACCESS_TOKEN` + `HARVEST_ACCOUNT_ID` override the file for CI/cron. Verify with `harvest-axi doctor`.

## Commands

| Command | What |
| --- | --- |
| `harvest-axi` | Home view: identity + today's hours/running timer + suggestions |
| `harvest-axi review [scope] [window] --by <axis>` | Period rollups — the headline |
| `harvest-axi browse clients\|projects\|tasks\|mine` | Reference data + what you can log against |
| `harvest-axi entries list\|today\|get\|log\|edit\|delete\|start\|stop` | Read + edit time entries (`list` is the batch read) |
| `harvest-axi invoices [get\|create\|edit\|delete]` | Review invoices + a draft workbench (Admin/Manager) |
| `harvest-axi estimates [get\|create\|edit\|delete]` | Review estimates + a draft workbench (Admin/Manager) |
| `harvest-axi auth\|doctor` | Credentials + health |
| `harvest-axi setup hooks` | Install/repair the SessionStart ambient hook |

```sh
harvest-axi review --team --this-week
harvest-axi review --client "Acme" --last-month --by project
harvest-axi entries log --project "GTFS Pathways" --task "T2: Project Management" --hours 1.5
harvest-axi invoices create --client "Acme" --line "Service|17000|1|Milestone 3|PA-PERMIT" --payment-options ach
```

### Handing data to a script (`--json-out` / `--csv-out`)

stdout is for the **agent**: TOON, capped, and it never changes shape because a
machine also wanted the data. When a *script* needs the full payload — turning
tracked time into invoice line items, or summing prior invoices for
cumulative-invoiced math — pass an export flag and it goes to a **file**,
additively:

```sh
harvest-axi entries list --project "GTFS Pathways" --last-month --json-out
# …the normal TOON view, unchanged, then:
# wrote: /tmp/harvest-axi/2026-08-05T19-31-54Z-entries.json (57 rows)
# columns: id, spent_date, user, project, task, client, hours, rounded_hours, …
# help[1]: Run `jq '[.entries[] | select(.billable)] | map(.rounded_hours) | add' <path>`
```

- **`--json-out[=path]`** and **`--csv-out[=path]`** — bare writes an
  owner-only (`0600`) file under the OS temp dir; `=path` persists it wherever
  you point. One export flag per invocation. The `=` form is required for an
  explicit path, so it can't swallow a positional.
- **The file ignores `--limit`.** stdout stays capped; the export always carries
  every matched record.
- **Available only where a script actually needs it** — `entries list`,
  `entries today|yesterday|get`, and `invoices`. `review`, `reports`, and
  `budget` are agent-read (a model lifts the number straight out of the TOON),
  so they reject the flags and point you at `entries list`.
- Entry payloads carry **both** `hours` and `rounded_hours`, so a billing script
  mirrors how Harvest bills without re-deriving the account's rounding rule.
- There is no `--json`-to-stdout mode, by design — see
  [`specs/behaviors/machine-output.md`](specs/behaviors/machine-output.md).

Exports can contain `billable_rate` / `cost_rate` and client names. Auto-generated
files are `0600`; an explicit `=path` is written with your umask.

### Invoices — a draft workbench

`harvest-axi invoices` lists/reviews invoices and builds **drafts** — it never sends, finalizes, closes, or records payments (do those in Harvest). Create free-form or `--from-tracked` time; `edit`/`delete` act on drafts only.

**Downloading the PDF.** Harvest publishes each invoice at a public `client_key` URL;
`invoices pdf <id>` fetches it so you don't have to `curl` it yourself:

```sh
harvest-axi invoices pdf 13150403                        # → $TMPDIR/harvest-axi/invoice-<number>-<id>.pdf
harvest-axi invoices pdf 13150403 --out=~/Desktop/inv.pdf
```

That URL is **public and unauthenticated** — anyone holding the link can read the
invoice — so auto-named downloads are written `0600`. An explicit `--out=<path>` is
yours to place, and uses the default umask. `invoices get <id>` shows the same `web` and
`pdf` links and points at this command.

Line items can link to a **project** via a trailing segment on `--line`/`--update-line` (`kind|unit_price|qty|desc|project`). The project accepts an **id or name** — resolved to Harvest's `project_id` — and reads back as the project's **name**:

```sh
# create with a project-linked line (name or id both work for the trailing segment)
harvest-axi invoices create --client "Acme" --line "Service|17000|1|Milestone 3|PA-PERMIT"

# add/change a line's project on an existing draft (blank segments are left unchanged)
harvest-axi invoices edit 12345 --update-line "67890|||||PA-PERMIT"

# enable online payment options (ach,credit_card,paypal) on a draft
harvest-axi invoices edit 12345 --payment-options ach,credit_card
```

A line's project must belong to the invoice's client and be billable, or Harvest rejects the change.

### Estimates — a draft workbench

`harvest-axi estimates` mirrors `invoices` for quoting — list/review with a by-state rollup (`draft·sent·accepted·declined`), full `get` detail, and a **draft workbench**. It never sends, marks-as-sent, accepts, or declines (do those in Harvest); `edit`/`delete` act on drafts only.

It's a strict subset of `invoices`: estimate line items are **not** project-linked (so `--line` is `kind|unit_price|qty|desc`, no trailing project), and there's no `--from-tracked`, no payment terms/options, and no payments.

```sh
harvest-axi estimates --drafts
harvest-axi estimates create --client "Acme" --line "Service|17000|1|Phase 1 scope" --subject "Q3 proposal"
harvest-axi estimates edit 12345 --notes "revised" --remove-line 67890
```

Run `harvest-axi <command> --help` for any command's full flag reference.

## Two ways to make it ambient (pick one)

`harvest-axi` integrates into your agent's session so state is visible before you act. You only need **one** of these:

1. **SessionStart hook (recommended)** — run `harvest-axi setup hooks` to register a hook that injects the live home view (today's hours, active timer, last entry, review suggestions) at the start of every session. Installs to Claude Code, Codex, and OpenCode. Idempotent and self-repairing — re-run it any time to repair a stale path.
2. **Installable skill** — a static [`SKILL.md`](.agents/skills/harvest-axi/SKILL.md) the agent loads on demand (no per-session cost, broader agent support). It carries the command guidance but not live state.

The hook gives you live data on every session; the skill is lower overhead and works anywhere. They're complementary — install whichever fits, or both.

## Development

```sh
bun install
bun run dev            # run the CLI from source
bun run build          # compile to dist/
bun test               # run the suite
```

Built on [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js). Mirrors the structure of [`gws-axi`](https://github.com/JarvusInnovations/gws-axi). Spec-driven — see [`specs/`](specs/) for desired state and [`plans/`](plans/) for the work DAG.
