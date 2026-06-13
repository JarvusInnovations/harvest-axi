import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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

// Config read/write ─────────────────────────────────────────────────
export function defaultConfig(): HarvestConfig {
  return { version: CONFIG_VERSION };
}

export function readConfig(): HarvestConfig {
  const path = configPath();
  if (!existsSync(path)) return defaultConfig();
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as HarvestConfig;
  } catch {
    return defaultConfig();
  }
}

export function writeConfig(cfg: HarvestConfig): void {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`);
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
