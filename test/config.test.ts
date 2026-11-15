import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheDir,
  configDir,
  configPath,
  readConfig,
  resolveCredentials,
  writeConfig,
} from "../src/config.js";
import { loadEntities } from "../src/harvest/resolve.js";

const mode = (path: string): number => statSync(path).mode & 0o777;

const STORED = { version: 1, account_id: "1234", token: "pat-secret" };

/** An install written by a version that left modes to the umask. */
function seedLooseInstall(): void {
  mkdirSync(configDir(), { recursive: true });
  chmodSync(configDir(), 0o755);
  writeFileSync(configPath(), `${JSON.stringify(STORED, null, 2)}\n`);
  chmodSync(configPath(), 0o644);
}

let previousUmask: number;

beforeEach(() => {
  // A typical umask, so a write that leaves the mode to it lands 0755/0644.
  previousUmask = process.umask(0o022);
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "");
});
afterEach(() => {
  process.umask(previousUmask);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// POSIX modes don't exist on Windows; chmod there only toggles read-only.
describe.skipIf(process.platform === "win32")("config permissions", () => {
  it("writes a fresh config 0600 in a 0700 directory", () => {
    writeConfig(STORED);
    expect(mode(configDir())).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
    expect(readConfig()).toEqual(STORED);
  });

  it("tightens a pre-existing 0755 directory and 0644 file on read", () => {
    seedLooseInstall();
    const before = readFileSync(configPath(), "utf-8");

    expect(readConfig()).toEqual(STORED);

    expect(mode(configDir())).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
    // Tightened in place: same token, no re-authentication.
    expect(readFileSync(configPath(), "utf-8")).toBe(before);
  });

  it("tightens a loose install when stored credentials are resolved", () => {
    seedLooseInstall();
    expect(resolveCredentials()).toEqual({
      token: "pat-secret",
      accountId: "1234",
      source: "config",
    });
    expect(mode(configDir())).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
  });

  it("tightens a loose install even when env credentials win", () => {
    seedLooseInstall();
    vi.stubEnv("HARVEST_ACCESS_TOKEN", "env-token");
    vi.stubEnv("HARVEST_ACCOUNT_ID", "99");

    expect(resolveCredentials()?.source).toBe("env");

    expect(mode(configDir())).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
  });

  it("leaves a pre-existing 0644 file 0600 after a rewrite", () => {
    seedLooseInstall();
    writeConfig({ ...STORED, default_user_id: 42 });
    expect(mode(configDir())).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
    expect(readConfig().default_user_id).toBe(42);
  });

  it("re-tightens on every write, not only the first", () => {
    writeConfig(STORED);
    chmodSync(configPath(), 0o644);
    chmodSync(configDir(), 0o755);
    writeConfig(STORED);
    expect(mode(configDir())).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
  });

  it("does not create the config directory on a read", () => {
    expect(readConfig()).toEqual({ version: 1 });
    expect(resolveCredentials()).toBeNull();
    expect(existsSync(configDir())).toBe(false);
  });

  it("writes the reference-data cache 0600 in 0700 directories", async () => {
    vi.stubEnv("HARVEST_ACCESS_TOKEN", "env-token");
    vi.stubEnv("HARVEST_ACCOUNT_ID", "99");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          clients: [{ id: 1, name: "Acme Corp" }],
          page: 1,
          per_page: 2000,
          total_pages: 1,
          total_entries: 1,
          links: { next: null },
        }),
        { status: 200 },
      ),
    );

    await loadEntities("client");

    expect(mode(configDir())).toBe(0o700);
    expect(mode(cacheDir())).toBe(0o700);
    expect(mode(join(cacheDir(), "client.json"))).toBe(0o600);
  });
});
