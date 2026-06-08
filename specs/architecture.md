# Architecture

## Stack

- **Runtime:** Node.js ≥ 20 (asdf-pinned: bun 1.3.11, nodejs 22.22.0). Authored in TypeScript, run via `bun` in dev, compiled with `tsc` to `dist/` for distribution.
- **CLI runtime:** [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js) (`runAxiCli`) — command-first dispatch, bare `--help`/`--version`, home-header injection, TOON serialization, structured errors, and best-effort session-hook auto-install.
- **Output:** [TOON](https://toonformat.dev/) via `@toon-format/toon`, at the output boundary only. Internal logic works on plain objects.
- **HTTP:** the platform `fetch` (Node ≥ 20). No SDK dependency on Harvest — we wrap the REST API directly.

## Project structure

Mirrors [`gws-axi`](https://github.com/JarvusInnovations/gws-axi):

```
bin/harvest-axi.ts        # shebang entry → src/cli.ts main()
src/
├── cli.ts                # runAxiCli wiring: description, version, command map, top help
├── config.ts             # ~/.config/harvest-axi state: PAT, account id, profile cache
├── harvest/
│   ├── client.ts         # authed fetch wrapper, pagination, error translation
│   └── paginate.ts       # paginate-to-completion helper over Harvest list responses
├── output/
│   ├── schema.ts         # FieldDef builders (field, pluck, mapEnum, truncated, computed)
│   ├── render.ts         # renderList / renderListResponse / renderObject / renderHelp
│   └── index.ts          # re-exports
├── time/ranges.ts        # human date-range parsing → {from, to} + stamped label
└── commands/
    ├── home.ts
    ├── auth.ts
    ├── review.ts
    ├── entries.ts  (+ entries/ subcommand dir)
    └── browse.ts   (+ browse/ subcommand dir)
```

The `output/` and `time/` modules are reusable infrastructure copied in spirit from gws-axi; commands stay focused on Harvest business logic.

## Config & state

- Config dir: `$XDG_CONFIG_HOME/harvest-axi` or `~/.config/harvest-axi`.
- `config.json` — `{ version, account_id, token, default_user_id, profile_cache }`. Token is a Harvest Personal Access Token.
- Env overrides (take precedence, for CI/cron): `HARVEST_ACCOUNT_ID`, `HARVEST_ACCESS_TOKEN`.
- `HARVEST_AXI_DISABLE_HOOKS=1` disables session-hook auto-install (mirrors `GWS_AXI_DISABLE_HOOKS`).

## Build & distribution

- `bun run build` → `tsc` → `dist/`, then `chmod +x dist/bin/harvest-axi.js`.
- Published `bin`: `harvest-axi → dist/bin/harvest-axi.js`.
- Tests colocated under `test/` mirroring `src/`, run with `vitest`.

## Principles

**Inherited** — see [`principles.md`](principles.md):

- [Token-based auth, unattended-friendly](principles.md#token-based-auth-unattended-friendly) — drives the PAT-in-config + env-override design above.
