# Command: auth + doctor

## auth setup

`harvest-axi auth setup` — agent-guided, non-interactive credential capture.

- Accepts `--token <pat>` and `--account <id>` flags.
- On receiving a token, validates by calling `GET /v2/users/me` (+ `/v2/company`), stores `{ account_id, token, default_user_id, profile_cache }` to `~/.config/harvest-axi/config.json`, **installs/repairs the SessionStart hook** (see below), and confirms with the resolved account + user name + hook status.
- With **no token but already configured**, re-validates the stored credentials, refreshes the profile cache, and (re)installs the hook — the "repair my ambient setup" path. With **no token and unconfigured**, returns a **structured instruction** (not a prompt) pointing at <https://id.getharvest.com/developers>, then exits 2.
- Idempotent: re-running with the same values revalidates and reports the existing identity (exit 0).
- If the token can see multiple accounts and `--account` is omitted/ambiguous, lists the candidate accounts (id + name) as a `VALIDATION_ERROR`.

### Session hook (ambient context)

`auth setup` is the **explicit opt-in** that registers the SessionStart hook (AXI principle 7 — hooks install from a user-invoked setup command, never from ordinary commands). The hook runs the home view at session start so the agent sees identity + today's hours + a running timer before acting. It is idempotent and self-repairing (the executable path is recomputed each setup run), targets Claude Code + Codex, and is suppressed entirely when `HARVEST_AXI_DISABLE_HOOKS=1`. The installable skill ([`.agents/skills/harvest-axi/SKILL.md`](../../.agents/skills/harvest-axi/SKILL.md)) is the complementary static alternative.

## auth whoami

`harvest-axi auth whoami` — prints the configured account + user (from cache; `--refresh` re-fetches `users/me`). Definitive "not configured" message when no creds.

## auth logout

`harvest-axi auth logout` — removes stored credentials (idempotent: no-op + exit 0 if already absent).

## doctor

`harvest-axi doctor` — health check: config present? token valid (`users/me`)? account reachable? Reports each check as pass/fail with the specific remediation command. Exit 0 if all pass, 1 otherwise.

## Auth resolution (used by all commands)

Order of precedence: env (`HARVEST_ACCESS_TOKEN` + `HARVEST_ACCOUNT_ID`) → config file. A command needing auth with neither present throws `TOKEN_INVALID` suggesting `harvest-axi auth setup`.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Token-based auth, unattended-friendly](../principles.md#token-based-auth-unattended-friendly) — PAT in config, env override for cron, no interactive flow.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — setup/logout re-runs are no-ops, missing flags fail fast with instructions instead of prompting.
