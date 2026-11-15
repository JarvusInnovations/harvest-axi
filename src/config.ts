import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_VERSION = 1;

export interface ProfileCache {
  user_id: number;
  user_name: string;
  account_name: string;
  /** "Monday" | "Sunday" | "Saturday" — from /v2/company; informs week windows. */
  week_start_day?: string;
  /** true → account uses start/end timers; false → duration mode. */
  wants_timestamp_timers?: boolean;
  /** e.g. "https://acme.harvestapp.com" — from /v2/company; builds public invoice URLs. */
  base_uri?: string;
  cached_at: string;
}

export interface HarvestConfig {
  version: number;
  account_id?: string;
  token?: string;
  default_user_id?: number;
  profile_cache?: ProfileCache;
}

/** Resolved credentials, from env (precedence) or config file. */
export interface Credentials {
  token: string;
  accountId: string;
  /** "env" | "config" — surfaced by doctor/whoami so the source is visible. */
  source: "env" | "config";
}

// Paths ────────────────────────────────────────────────────────────
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "harvest-axi") : join(homedir(), ".config", "harvest-axi");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function cacheDir(): string {
  return join(configDir(), "cache");
}

// Private modes ────────────────────────────────────────────────────
// The config directory holds the access token, so everything under it is
// private to the user: directories 0700, files 0600 (specs/architecture.md
// § Config & state). All of it is best-effort — a failed chmod (a directory
// the user doesn't own, a filesystem without POSIX modes) never fails a command.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** chmod `path` to `mode` only when it is group- or world-accessible. */
function tighten(path: string, mode: number): void {
  try {
    if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, mode);
  } catch {
    // Missing path or not ours to chmod — nothing to tighten.
  }
}

/** Create `dir` at 0700, or tighten it when it already exists wider. */
export function ensurePrivateDir(dir: string): void {
  if (existsSync(dir)) {
    tighten(dir, DIR_MODE);
    return;
  }
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // The creation mode is subject to the umask, so set it explicitly.
  try {
    chmodSync(dir, DIR_MODE);
  } catch {
    // Best-effort.
  }
}

/**
 * Write `data` to `path` at 0600. The creation mode only applies to a new
 * file, so an existing loose file is tightened before the new content lands
 * and the mode is set again after the write.
 */
export function writePrivateFile(path: string, data: string): void {
  tighten(path, FILE_MODE);
  writeFileSync(path, data, { mode: FILE_MODE });
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    // Best-effort.
  }
}

/**
 * Tighten an existing install: a config directory or `config.json` written by
 * an older version (0755 / 0644 under a typical umask) is fixed in place the
 * next time the tool touches config, with no re-authentication. Never creates
 * anything.
 */
export function tightenConfigPermissions(): void {
  tighten(configDir(), DIR_MODE);
  tighten(configPath(), FILE_MODE);
}

// Config read/write ─────────────────────────────────────────────────
export function defaultConfig(): HarvestConfig {
  return { version: CONFIG_VERSION };
}

export function readConfig(): HarvestConfig {
  tightenConfigPermissions();
  const path = configPath();
  if (!existsSync(path)) return defaultConfig();
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as HarvestConfig;
  } catch {
    return defaultConfig();
  }
}

export function writeConfig(cfg: HarvestConfig): void {
  ensurePrivateDir(configDir());
  writePrivateFile(configPath(), `${JSON.stringify(cfg, null, 2)}\n`);
}

export function clearConfig(): void {
  const path = configPath();
  if (existsSync(path)) rmSync(path, { force: true });
}

// Credential resolution ─────────────────────────────────────────────
/**
 * Resolve credentials with env taking precedence over the config file, per
 * the architecture spec (env overrides exist for CI/cron). Returns null when
 * neither source provides a complete token + account id pair.
 */
export function resolveCredentials(): Credentials | null {
  // Env credentials skip the config read below, but a stale stored token
  // still deserves private modes.
  tightenConfigPermissions();
  const envToken = process.env.HARVEST_ACCESS_TOKEN;
  const envAccount = process.env.HARVEST_ACCOUNT_ID;
  if (envToken && envAccount) {
    return { token: envToken, accountId: envAccount, source: "env" };
  }

  const cfg = readConfig();
  if (cfg.token && cfg.account_id) {
    return { token: cfg.token, accountId: cfg.account_id, source: "config" };
  }

  return null;
}

export function isConfigured(): boolean {
  return resolveCredentials() !== null;
}
