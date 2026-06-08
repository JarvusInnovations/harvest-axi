---
status: planned
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

- [ ] Session start injects the home dashboard (identity + today line + review suggestions) at ≤1 API call.
- [ ] Hook install is idempotent and repairs a stale exec path; `HARVEST_AXI_DISABLE_HOOKS=1` suppresses it.
- [ ] Today line shows hours/count/running-timer and degrades gracefully when the call fails.
- [ ] `SKILL.md` carries trigger-shaped frontmatter and runnable `npx`-form commands, with no live state baked in.
- [ ] README presents hook and skill as alternatives.

## Risks / unknowns

- **Codex/OpenCode parity** — SDK targets Claude Code + Codex by default; OpenCode plugin path is a stretch goal, note if deferred.

## Notes

## Follow-ups
