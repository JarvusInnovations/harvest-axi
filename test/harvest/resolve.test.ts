import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEntity } from "../../src/harvest/resolve.js";

function listPage(key: string, items: unknown[]): Response {
  return new Response(
    JSON.stringify({
      [key]: items,
      page: 1,
      per_page: 2000,
      total_pages: 1,
      total_entries: items.length,
      links: { next: null },
    }),
    { status: 200 },
  );
}

const CLIENTS = [
  { id: 1, name: "Caltrans" },
  { id: 2, name: "Acme Corp" },
  { id: 3, name: "Acme Labs" },
];

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "tok");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveEntity", () => {
  it("passes a numeric id through without any fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await resolveEntity("client", "42");
    expect(r.id).toBe(42);
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves an exact name (case-insensitive)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage("clients", CLIENTS));
    const r = await resolveEntity("client", "caltrans");
    expect(r).toMatchObject({ id: 1, name: "Caltrans" });
  });

  it("resolves a unique substring", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage("clients", CLIENTS));
    const r = await resolveEntity("client", "caltr");
    expect(r.id).toBe(1);
  });

  it("rejects an ambiguous name with candidates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage("clients", CLIENTS));
    await expect(resolveEntity("client", "acme")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a no-match name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage("clients", CLIENTS));
    await expect(resolveEntity("client", "zzz")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("caches the list — a second resolve does not re-fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage("clients", CLIENTS));
    await resolveEntity("client", "caltrans");
    await resolveEntity("client", "acme corp");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
