---
status: done
depends: [ambient]
specs:
  - specs/commands/hook.md
issues: []
---

# Plan: Hook command — discoverable session-hook management

## Scope

Add a first-class `hook` command (`install` / `status` / `uninstall`) so the SessionStart hook is discoverable and manageable, not just a side-effect of `auth setup`. **In:** the command + status/uninstall logic over the two JSON targets. **Out:** changing `auth setup`'s convenience install (it stays); the OpenCode plugin file (the SDK manages it on install; uninstall covers the two JSON hook targets).

## Implements

- `specs/commands/hook.md` — `hook` (status default) / `install` / `uninstall`, idempotent, env-gated, Claude Code + Codex targets, harvest-axi identification by command substring.

## Approach

1. `src/commands/hook.ts` — dispatch `install|status|uninstall` (bare → status).
2. `install` → `installSessionStartHooks({ onError })` (gated by `HARVEST_AXI_DISABLE_HOOKS`), then render status.
3. `status` → read `~/.claude/settings.json` and `~/.codex/hooks.json`, find the SessionStart group whose `hooks[].command` includes `harvest-axi`, report `{agent, installed, command}`.
4. `uninstall` → filter out harvest-axi groups from `.hooks.SessionStart`, write back if changed; idempotent no-op when absent.
5. Wire into `cli.ts` (+ TOP_HELP 7→8 commands, + getCommandHelp); add `HOOK_HELP`.

## Validation

- [x] `hook status` reports install state + command per target against the live machine. _(live: both targets)_
- [x] `hook install` installs/repairs idempotently; `HARVEST_AXI_DISABLE_HOOKS=1` makes it a no-op that says so. _(live: repaired abs dist path → portable `harvest-axi`; disabled-no-op unit-tested)_
- [x] `hook uninstall` removes only harvest-axi's entries (others untouched); a second run is a no-op exit 0. _(live round-trip; unit: gh-axi/gws-axi kept)_
- [x] `hook` (no args) shows status (content-first). _(unit + live)_
- [x] Dogfooded: uninstall → status(absent) → install → status(present), leaving it installed. _(live)_

## Risks / unknowns

- **JSON shape drift** — relies on `.hooks.SessionStart[]` in both files; verified against the live machine's settings.

## Notes

- `hook install` resolves to the **portable `harvest-axi` binary name** now that it's on PATH (the SDK's `resolvePortableHookCommand` prefers a PATH-verified name over the absolute path) — matching gh-axi/gws-axi. The earlier `auth setup` install had written the absolute dist path; `hook install` repaired it.
- `auth setup` keeps its convenience install; `hook` is the explicit manager. Both call the same SDK primitive, so they stay consistent.
- `uninstall` covers the two JSON targets (Claude Code + Codex), identifying our groups by a `harvest-axi` substring in the command.

## Follow-ups

- Tracked as: `hook uninstall` could also remove the SDK-managed OpenCode ambient plugin file; deferred (the JSON hook targets are what this machine uses).
