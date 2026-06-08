import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authCommand } from "../../src/commands/auth.js";
import { configPath } from "../../src/config.js";
import { fetchAccounts, whoMe } from "../../src/harvest/identity.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

const ME = { id: 42, first_name: "Chris", last_name: "Alfano", email: "chris@jarv.us" };
const COMPANY = { name: "Jarvus Innovations", week_start_day: "Monday", wants_timestamp_timers: false };

beforeEach(() => {
  // Isolate config to a throwaway dir; ensure real env creds don't leak in.
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
});

describe("identity", () => {
  it("whoMe builds a profile from users/me + company", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(COMPANY));
    const profile = await whoMe({ token: "t", accountId: "1", source: "config" });
    expect(profile).toMatchObject({
      user_id: 42,
      user_name: "Chris Alfano",
      account_name: "Jarvus Innovations",
      week_start_day: "Monday",
      wants_timestamp_timers: false,
    });
  });

  it("fetchAccounts filters out non-harvest products", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        accounts: [
          { id: 1, name: "Co", product: "harvest" },
          { id: 2, name: "Fc", product: "forecast" },
        ],
      }),
    );
    const accounts = await fetchAccounts("t");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(1);
  });

  it("fetchAccounts throws TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(fetchAccounts("bad")).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });
});

describe("auth setup", () => {
  it("fails fast with minting instructions when no token is given", async () => {
    await expect(authCommand(["setup"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("auto-selects the single harvest account, validates, and writes config", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ id: 777, name: "Jarvus Innovations", product: "harvest" }] }))
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(COMPANY));

    const out = await authCommand(["setup", "--token", "pat_xxx"]);
    expect(out).toContain("connected");
    expect(out).toContain("Jarvus Innovations");
    expect(out).toContain("Chris Alfano");

    expect(existsSync(configPath())).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(cfg.account_id).toBe("777");
    expect(cfg.default_user_id).toBe(42);
    expect(cfg.token).toBe("pat_xxx");
  });

  it("lists candidates when the token sees multiple accounts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        accounts: [
          { id: 1, name: "Alpha", product: "harvest" },
          { id: 2, name: "Beta", product: "harvest" },
        ],
      }),
    );
    await expect(authCommand(["setup", "--token", "t"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("skips account discovery when --account is explicit", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(jsonResponse(COMPANY));
    await authCommand(["setup", "--token", "t", "--account", "999"]);
    // Only users/me + company — no call to the accounts endpoint.
    expect(spy).toHaveBeenCalledTimes(2);
    const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(cfg.account_id).toBe("999");
  });
});

describe("auth whoami / logout", () => {
  it("reports not configured when there are no credentials", async () => {
    const out = await authCommand(["whoami"]);
    expect(out).toContain("not configured");
  });

  it("logout is a no-op when nothing is stored", async () => {
    const out = await authCommand(["logout"]);
    expect(out).toContain("no-op");
  });
});
