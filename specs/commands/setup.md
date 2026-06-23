# Command: setup

Explicit, discoverable installation of the SessionStart hook that makes the home view ambient. This is the **only** way the hook is installed (AXI principle 7: hooks register only from a user-invoked setup command, never as a side effect of ordinary commands). Mirrors the first-party reference tools (`gh-axi`, `chrome-devtools-axi`) and the sibling AXIs (`slack-axi`): a single `setup hooks` action that installs or repairs, nothing more.

## Subcommands

- `setup hooks` — install or repair the SessionStart hook across Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/hooks.json` + `config.toml`), and the OpenCode ambient-context plugin. Idempotent (re-running with the same resolved command is a silent no-op) and self-repairing (updates the command if the executable path changed). Delegates entirely to the SDK's `installSessionStartHooks({ marker: "harvest-axi", timeoutSeconds: 10 })`.
- `setup --help` / `setup hooks --help` — print the reference (`SETUP_HELP`).
- Any other action → `VALIDATION_ERROR` pointing at `harvest-axi setup hooks`.

There is no `status` or `uninstall` subcommand: those are not part of the AXI standard or SDK, and the first-party tools don't provide them. Re-running `setup hooks` repairs; removal is a manual settings.json edit.

## Output

```
hooks:
  status: installed
  integrations: Claude Code, Codex, OpenCode
  marker: harvest-axi
help[1]:
  Restart your agent session to receive harvest-axi ambient context
```

On any SDK-reported problem, fail with a `HOOK_INSTALL_FAILED` error carrying the underlying messages.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — repeated installs with the same path are exit-0 no-ops.
- [Token-based auth, unattended-friendly](../principles.md#token-based-auth-unattended-friendly) — the hook is the ambient-context delivery mechanism; installation is explicit opt-in via `setup hooks`.
