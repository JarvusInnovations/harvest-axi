---
status: in-progress
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

- [ ] `harvest-axi auth setup --token X --account Y` against a real PAT stores config and prints the resolved account + user name.
- [ ] Re-running `auth setup` with the same creds revalidates, reports existing identity, exit 0 (idempotent).
- [ ] `auth setup` with no flags returns the PAT-minting instruction and exit 2 (no prompt, no hang).
- [ ] `auth whoami` prints cached identity; `--refresh` re-fetches; unconfigured → definitive "not configured".
- [ ] `auth logout` removes creds; second run is a no-op exit 0.
- [ ] `doctor` reports all checks; exit 0 when healthy, 1 when token invalid.
- [ ] `harvest-axi` (no args) configured → identity + review suggestions; unconfigured → setup suggestion.

## Risks / unknowns

- **Multi-account discovery** — the Harvest API selects account via header; enumerating accounts a token can see may require the `id.getharvest.com` accounts endpoint, not `api.harvestapp.com`. Validate against the live token; if unavailable, require explicit `--account` and document where to find the id. Record the resolution in Notes.

## Notes

## Follow-ups
