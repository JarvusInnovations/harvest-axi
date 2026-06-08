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
|---|---|
| `harvest-axi` | Home view: identity + today's hours/running timer + suggestions |
| `harvest-axi review [scope] [window] --by <axis>` | Period rollups — the headline |
| `harvest-axi browse clients\|projects\|tasks\|mine` | Reference data + what you can log against |
| `harvest-axi entries today\|get\|log\|edit\|delete\|start\|stop` | Read + edit your time entries |
| `harvest-axi auth\|doctor` | Credentials + health |

```sh
harvest-axi review --team --this-week
harvest-axi review --client "Acme" --last-month --by project
harvest-axi entries log --project "GTFS Pathways" --task "T2: Project Management" --hours 1.5
```

Run `harvest-axi <command> --help` for any command's full flag reference.

## Two ways to make it ambient (pick one)

`harvest-axi` integrates into your agent's session so state is visible before you act. You only need **one** of these:

1. **SessionStart hook (recommended)** — running the installed binary registers a hook that injects the live home view (today's hours, running timer, review suggestions) at the start of every session. Idempotent; repairs its own path on reinstall. Disable with `HARVEST_AXI_DISABLE_HOOKS=1`.
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
