# Principles

The project's philosophy, written down as decisive rules. Each picks a side of a real trade-off so an implementer can resolve an unspecified case the way the author would. These are distilled from the [AXI principles](https://axi.md), the lessons of [slack-axi](https://github.com/JarvusInnovations/slack-axi)'s `catchup`, and the pain of using the raw [harvest-mcp-server](https://github.com/taiste/harvest-mcp-server).

## Review is the center of gravity

The reason harvest-axi exists is **reviewing time entries over a period** — for myself, my whole team, a project, or a client. Every other command (browse, entry edits, reports) exists to support or follow from that workflow. When a design choice trades off review ergonomics against anything else, favor review. The home view, the default schemas, and the contextual suggestions should all funnel an agent toward "show me what was tracked over this window, scoped this way."

## Human time in, stamped range out
>
> The painful MCP took raw Unix epoch params. Hand-computing epoch seconds is error-prone and the API silently returns whatever matches the wrong window.

Never make the agent compute timestamps. Accept human date ranges — `--from 2026-06-01 --to 2026-06-07`, `--since 7d`, `--month`, `--week`, named windows like `today`/`yesterday` — convert internally, and **echo the resolved, year-stamped range back in the output header** so the agent can sanity-check the window at a glance. A wrong window must be visible, not silent.

## Paginate to completion; never silently cap
>
> slack-axi's oldest-first pagination gaps produced "no messages on the first pass" and missing data.

Read commands that answer "everything over this period" must paginate the Harvest endpoint to completion and emit an explicit `complete: true` marker. When a result set is deliberately bounded (a `--limit` on a flat list), state the cap loudly — `[50 of 1564]` plus a raise/narrow hint — never a silent truncation that reads as "this is all there is."

## Rollups over raw; detail on demand

A period review of hundreds of entries must not dump hundreds of rows by default. Lead with **pre-computed aggregates** — total hours, billable vs non-billable, per-scope subtotals (by user / project / client / task / day depending on the grouping) — because that is the answer to the actual question. The raw entry rows are available behind an explicit flag or a narrower scope. Every entry row carries a stable `id` so the agent can chase any single entry with a detail view instead of us inlining everything.

## Idempotent, non-interactive mutations

Every write completes with flags alone — never prompt. Stopping an already-stopped timer, or closing state that already holds, is a no-op with exit 0, not an error. Reserve non-zero exits for intents that genuinely cannot be satisfied. Edits to time entries default to **the authenticated user's own entries**; touching someone else's requires an explicit, unambiguous `--user`.

## Translate errors; never leak raw API noise

Harvest error bodies, 429s, and validation failures get translated into structured AXI errors on stdout with an actionable suggestion that references a `harvest-axi` command — never a raw stack trace, never the underlying endpoint name. A `429` says how long to wait (Reports API is 100 req / 15 min — far tighter than the standard 100 / 15 s, so review-over-reports must respect it).

## Token-based auth, unattended-friendly

Auth is a Harvest Personal Access Token + Account ID stored in config (env-overridable), set up via an agent-guided `auth setup`. No interactive OAuth, no browser callback — so cron and background review sweeps run unattended. This is the gws-axi / slack-axi pattern.
