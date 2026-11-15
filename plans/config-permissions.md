---
status: in-progress
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

- [ ] A fresh `writeConfig()` under umask `022` leaves the directory `0700` and `config.json` `0600`
- [ ] A pre-existing `0755` directory + `0644` `config.json` is tightened by `readConfig()` alone, content unchanged
- [ ] The same loose pair is tightened by `resolveCredentials()` when env credentials win
- [ ] `writeConfig()` over a pre-existing `0644` file leaves it `0600`
- [ ] The reference-data cache directory is `0700` and its files `0600`
- [ ] A missing config directory is not created by a read
- [ ] Full check set green (lint, format, typecheck, build, tests)

## Risks / unknowns

- **`chmod` on a directory the user doesn't own** (a shared or root-provisioned
  config dir) fails; it must not fail the command. All tightening is best-effort.
- **Windows** has no POSIX modes; `chmod` is close to a no-op there and the mode
  tests are skipped on `win32`.
