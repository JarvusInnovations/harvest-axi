---
status: done
depends: [review, browse, entries-write]
specs:
  - specs/commands/home.md
issues: []
---

# Plan: Ambient — session hook, skill, enriched home

## Scope

Make harvest-axi ambient and discoverable. **In:** the SessionStart hook (verify the SDK auto-install + a `setup`-style repair path), the **enriched home view** (add the "today" line — total hours, count, running timer — deferred here from `auth-identity`), an installable static skill generated from the home guidance, and README finalization (hook vs skill as two paths). **Out:** new command surface.

## Implements

- `specs/commands/home.md` — completes the configured home output by adding the live "today" line (one `time_entries?from=today&to=today&user_id=me` call), keeping the per-session cost to a single API call per the token-budget discipline.

## Approach

1. Confirm `runAxiCli`'s hook auto-install registers `harvest-axi` for Claude Code + Codex; add/verify a portable exec-path policy (PATH-verified binary name, absolute fallback) and idempotent repair.
2. Enrich `home.ts` with the today-line (absorbs the `auth-identity` deferral); preserve graceful degradation when the single call fails (show identity + suggestions without the line).
3. Generate `SKILL.md` from the same home guidance (strip live state, `npx`-form commands, trigger-shaped frontmatter); add a `--check` build step later if siblings adopt one (follow-up).
4. README: document the hook (ambient + live) and the skill (lower overhead) as two ways to the same end.

## Validation

- [x] Session start injects the home dashboard (identity + today line + review suggestions) at ≤1 API call. _(home makes exactly one `time_entries?from=today&to=today` call; live home view verified. The hook that runs it lands per the integration test below.)_
- [x] Hook install is idempotent and repairs a stale exec path; `HARVEST_AXI_DISABLE_HOOKS=1` suppresses it. _(unit-tested in `hooks.test.ts`: lands referencing harvest-axi, no-op on re-install, command updates on path change; disable-gate verified via the auth revalidate test)_
- [x] Today line shows hours/count/running-timer and degrades gracefully when the call fails. _(live: "nothing logged yet"; hours/running format unit-tested via `entries today`; degradation is the try/catch returning undefined)_
- [x] `SKILL.md` carries trigger-shaped frontmatter and runnable `npx`-form commands, with no live state baked in. _(`.agents/skills/harvest-axi/SKILL.md`)_
- [x] README presents hook and skill as alternatives. _("Two ways to make it ambient")_

## Risks / unknowns

- **Codex/OpenCode parity** — the SDK writes both `~/.claude/settings.json` and `~/.codex/hooks.json`; the integration test asserts the Claude target. OpenCode plugin path is handled by the SDK's `installOpenCodeAmbientPlugin`; not separately verified here.

## Notes

- **`axi-sdk-js` 0.1.7 dropped runAxiCli's automatic hook install** (0.1.4 auto-installed on every run). 0.1.7 requires calling `installSessionStartHooks()` explicitly — which is _better_ aligned with AXI principle 7 (hooks register only from a user-invoked setup command). So the hook now installs from `auth setup` only, gated by `HARVEST_AXI_DISABLE_HOOKS`. Removed the dead `hooks: false` option from `cli.ts`.
- **`auth setup` gained a no-token-while-configured path**: revalidates stored creds + (re)installs the hook — the "repair my ambient setup" entry point that doesn't need the token re-entered. `auth.md` spec updated to match (spec-first).
- **Live global hook install is the user's opt-in**: running `harvest-axi auth setup` writes to the real `~/.claude/settings.json`. Validated the mechanism via an explicit-`homeDir` unit test because the sandbox blocks `HOME`-override invocations (exit 126). The real install is a one-liner the user runs when ready.
- Home view makes exactly one API call (today's entries); on any failure it drops the `today:` line and still renders identity + suggestions.

## Follow-ups

- Tracked as: install the global SessionStart hook in the user's real `~/.claude` by running `harvest-axi auth setup` (opt-in; mutates global config) — offered to the user at ambient closeout.
- Tracked as: a CI `--check` step asserting `SKILL.md` stays in sync with the home guidance was deferred (sibling AXIs don't have it yet; gold-plating until harvest-axi is published).
