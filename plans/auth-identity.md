---
status: done
depends: [foundation]
specs:
  - specs/commands/auth.md
  - specs/commands/home.md
issues: []
---

# Plan: Auth & identity

## Scope

**In:** the `auth` command group (`setup`, `whoami`, `logout`), the `doctor` health check, identity resolution via `GET /v2/users/me`, and a **basic home view** (identity + setup state + review-leaning suggestions). **Out:** the home "today" line (needs entry reads — deferred to `ambient`); multi-account juggling (single-account per [principles](../../specs/principles.md#token-based-auth-unattended-friendly)).

## Implements

- `specs/commands/auth.md` — setup (flag-driven, validates via `users/me`, stores config, idempotent, multi-account-candidate listing), whoami (`--refresh`), logout (idempotent), doctor (per-check pass/fail + remediation), and the env→config auth resolution order used by all commands.
- `specs/commands/home.md` — the configured (minus today-line) and unconfigured home outputs.

## Approach

1. `src/harvest/identity.ts` — `whoMe(creds)` → `{ user: {id,name}, account: {name} }` (from `users/me`), cached into `config.json` as `profile_cache` + `default_user_id`.
2. `src/commands/auth.ts` — subcommand dispatch (`setup`/`whoami`/`logout`) + `AUTH_HELP`. `setup` reads `--token`/`--account`; if missing, return the structured "mint a PAT at id.getharvest.com/developers" instruction and exit 2. On both present: validate, store, confirm. Multiple visible accounts + no `--account` → `VALIDATION_ERROR` listing candidates (call `GET /v2/users/me` per account id is not possible pre-selection; instead surface the account list the token error returns, or document the manual id path).
3. `src/commands/doctor.ts` + `DOCTOR_HELP` — checks: config present, token valid, account reachable; TOON pass/fail rows.
4. `src/commands/home.ts` — identity + `setup:` progress; suggestions lead with `review --since 7d` / `review --team --this-week`. Unconfigured → `auth setup` suggestion only.
5. Register `auth`, `doctor` in `cli.ts`; wire `home`.

## Validation

- [x] `harvest-axi auth setup --token X --account Y` against a real PAT stores config and prints the resolved account + user name. _(live: connected as Chris Alfano / Jarvus Innovations, account 192183)_
- [x] Re-running `auth setup` with the same creds revalidates, reports existing identity, exit 0 (idempotent). _(unit-tested — not re-run live to avoid needing the token in-session)_
- [x] `auth setup` with no flags returns the PAT-minting instruction and exit 2 (no prompt, no hang). _(live)_
- [x] `auth whoami` prints cached identity; `--refresh` re-fetches; unconfigured → definitive "not configured". _(cached + unconfigured live; cache-vs-refresh unit-tested)_
- [x] `auth logout` removes creds; second run is a no-op exit 0. _(no-op live; removal unit-tested — not run live to avoid wiping the user's fresh config)_
- [x] `doctor` reports all checks; exit 0 when healthy, 1 when token invalid. _(healthy exit 0 live; failing exit 1 live via unconfigured)_
- [x] `harvest-axi` (no args) configured → identity + review suggestions; unconfigured → setup suggestion. _(both live)_

## Risks / unknowns

- **Multi-account discovery** — RESOLVED (see Notes): the `id.getharvest.com/api/v2/accounts` endpoint works with the PAT, so setup auto-selects a lone account and lists candidates otherwise.

## Notes

- **Multi-account resolution works cleanly**: `GET https://id.getharvest.com/api/v2/accounts` (Bearer token, no account header) returns the accessible accounts; we filter to `product: "harvest"`, auto-select when there's one, and list `--account <id> (name)` candidates when there are several. Risk closed.
- **Live account facts captured into `profile_cache`** (from `/v2/company`): `week_start_day = Monday` — confirms foundation's Monday week default is correct for this account (closes that foundation follow-up for now); `wants_timestamp_timers = false` → this account tracks in **duration mode**, so `entries log` should default to `--hours` rather than `--started/--ended`.
- Idempotent re-run, logout removal, and whoami cache/refresh are verified by unit tests rather than live re-runs — re-running them against the live account would require the token in-session or would wipe the just-created config.

## Follow-ups

- Deferred to [`entries-write`](entries-write.md) — use the cached `profile_cache.wants_timestamp_timers` to choose duration vs start/end mode for `entries log`/`edit`, instead of guessing.
