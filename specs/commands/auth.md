# Command: auth + doctor

## auth setup

`harvest-axi auth setup` — agent-guided, non-interactive credential capture.

- Accepts `--token <pat>` and `--account <id>` flags. When missing, returns a **structured instruction** (not a prompt) telling the agent/user where to mint a Personal Access Token (<https://id.getharvest.com/developers>) and how to pass them, then exits 2.
- On receiving both, validates by calling `GET /v2/users/me`, stores `{ account_id, token, default_user_id, profile_cache }` to `~/.config/harvest-axi/config.json`, and confirms with the resolved account + user name.
- Idempotent: re-running with the same values revalidates and reports the existing identity (exit 0).
- If the token can see multiple accounts and `--account` is omitted/ambiguous, lists the candidate accounts (id + name) as a `VALIDATION_ERROR`.

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
