---
status: done
depends: []
specs:
  - specs/architecture.md
  - specs/commands/auth.md
issues: [23]
---

# Plan: Private modes for the config directory and token file

## Scope

**In:** the "Should fix" item of #23. `writeConfig()` creates `~/.config/harvest-axi`
and `config.json` with no explicit mode, so under a typical umask the directory is
`0755` and the token file `0644` — readable by other users on the machine. Make the
directory `0700` and the file `0600`, set the mode after every write, and tighten an
already-loose directory or file the next time the tool touches config, so existing
installs are fixed without re-authenticating. The reference-data cache under
`cache/` gets the same modes.

**Out:** the "Smaller" items of #23 (`formatError`, generated skill + drift gate,
structured no-ops, `--version` fast path, `account_source: env`, CI smoke test) —
each is its own plan. Reporting file modes in `doctor` is also out.

## Implements

- `specs/architecture.md` — Config & state: the **Modes** and **Existing installs
  self-heal** rules.
- `specs/commands/auth.md` — `auth setup` stores the token `0600` in a `0700` directory.

## Approach

Port the `ensureDir` + `chmod`-after-write shape from the canonical source
(`nexudus-axi` `src/config.ts`), adapted to this tool's single `config.json`:

1. `src/config.ts`
   - `ensurePrivateDir(dir)` — `mkdir` at `0700` when missing, else `chmod 0700`
     when the existing mode is wider. Best-effort.
   - `writePrivateFile(path, data)` — write with mode `0600`, then `chmod 0600`
     (the creation mode only applies to a new file, and the umask can widen it).
     An existing loose file is tightened *before* the new content is written.
   - `tightenConfigPermissions()` — `stat` the directory and `config.json`; `chmod`
     only when group/world bits are set. Called from `readConfig()`,
     `writeConfig()` and `resolveCredentials()` (so an env-credentialed run still
     heals a stale stored token).
2. `src/harvest/resolve.ts` — the cache writer uses the same two helpers, so a
   first run with env credentials doesn't create the config directory `0755`.

## Validation

- [x] A fresh `writeConfig()` under umask `022` leaves the directory `0700` and `config.json` `0600`
- [x] A pre-existing `0755` directory + `0644` `config.json` is tightened by `readConfig()` alone, content unchanged
- [x] The same loose pair is tightened by `resolveCredentials()` when env credentials win
- [x] `writeConfig()` over a pre-existing `0644` file leaves it `0600`
- [x] The reference-data cache directory is `0700` and its files `0600`
- [x] A missing config directory is not created by a read
- [x] Full check set green (lint, format, typecheck, build, tests)

## Risks / unknowns

- **`chmod` on a directory the user doesn't own** (a shared or root-provisioned
  config dir) fails; it must not fail the command. All tightening is best-effort.
- **Windows** has no POSIX modes; `chmod` is close to a no-op there and the mode
  tests are skipped on `win32`.

## Notes

- **Tightening only `chmod`s when group/world bits are set** (one `stat` per
  path otherwise), so the common already-private case costs no write syscall and
  a directory the user can read but doesn't own is left alone without error.
- **`resolveCredentials()` tightens too**, not just `readConfig()`/`writeConfig()`:
  with env credentials the config file is never read on that path, and a stale
  stored token should still end up private.
- **The cache writer was creating the config directory `0755`** on a first run
  with env credentials (`mkdirSync(cacheDir(), { recursive: true })`), which
  would have left a later `auth setup` relying on the self-heal. It now goes
  through the same helpers.
- 280 tests (+8): `test/config.test.ts`, run under an explicit `022` umask so
  they fail against a write that leaves the mode to it.

## Follow-ups

- The "Smaller" items of #23 remain open, one plan each.
- `doctor` could report the config file's mode as a check; not specced.
