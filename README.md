<h1 align="center">harvest-axi</h1>

<p align="center">An <a href="https://axi.md">AXI</a>-compliant CLI for <a href="https://www.getharvest.com/">Harvest</a> time tracking — built for agents.</p>

`harvest-axi` wraps the [Harvest API v2](https://help.getharvest.com/api-v2/) in an agent-ergonomic CLI: token-efficient [TOON](https://toonformat.dev/) output, human date ranges in / year-stamped ranges out, paginate-to-completion reads, and idempotent timesheet edits.

Its headline workflow is **period-based time-entry review** — for yourself, your whole team, a project, or a client — modeled on the "catch-up" pattern from [slack-axi](https://github.com/JarvusInnovations/slack-axi).

## Status

Early development. See [`specs/`](specs/) for the desired-state specification and [`plans/`](plans/) for the work-in-flight DAG.

## Development

```sh
bun install
bun run dev            # run the CLI from source
bun run build          # compile to dist/
bun test               # run the suite
```

Built on [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js). Mirrors the structure of [`gws-axi`](https://github.com/JarvusInnovations/gws-axi).
