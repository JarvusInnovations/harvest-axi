# Command: hook

Explicit, discoverable management of the SessionStart hook that makes the home view ambient. This is the canonical installer (AXI principle 7: hooks register only from a user-invoked command); `auth setup` also installs it as a convenience, but `hook` is where you inspect, repair, or remove it.

## Subcommands

- `hook` (no args) / `hook status` — show, per agent target (Claude Code, Codex), whether harvest-axi's SessionStart hook is installed and the exact command it runs. Read-only. Content-first: bare `hook` shows status, not help.
- `hook install` — install or repair the hook for Claude Code (`~/.claude/settings.json`) and Codex (`~/.codex/hooks.json`). Idempotent (re-running with the same resolved command is a no-op); self-repairing (updates the command if the executable path changed). Suppressed entirely when `HARVEST_AXI_DISABLE_HOOKS=1`. Delegates to the SDK's `installSessionStartHooks`.
- `hook uninstall` — remove harvest-axi's SessionStart entries from both targets. Idempotent: a no-op with exit 0 when none are present. Leaves other tools' hooks untouched.

## Identification

A SessionStart group belongs to harvest-axi when any of its `hooks[].command` contains `harvest-axi` (matches both the portable `harvest-axi` binary name and an absolute `…/dist/bin/harvest-axi.js` path). Both targets share the `.hooks.SessionStart[]` shape (array of `{ matcher, hooks: [{ type, command, timeout }] }`).

## Output

```
hooks[2]{agent,installed,command}:
  Claude Code,true,harvest-axi
  Codex,true,harvest-axi
help[2]:
  Run `harvest-axi hook uninstall` to remove the session hook
  Run `harvest-axi --help` to see the full command list, or `<command> --help` for usage on any command
```

- `install` reports the resulting status (same table) plus a one-line confirmation; when disabled via env, says so and changes nothing.
- `uninstall` reports which targets were cleared, or a definitive no-op when none were present.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — install repair and uninstall-when-absent are exit-0 no-ops.
- [Token-based auth, unattended-friendly](../principles.md#token-based-auth-unattended-friendly) — the hook is the ambient-context delivery mechanism; `HARVEST_AXI_DISABLE_HOOKS=1` opts out everywhere.
