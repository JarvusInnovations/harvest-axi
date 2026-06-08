import { afterEach, describe, expect, it, vi } from "vitest";
import { harvestRequest } from "../../src/harvest/client.js";
import type { Credentials } from "../../src/config.js";

const CREDS: Credentials = { token: "tok", accountId: "123", source: "config" };

afterEach(() => vi.restoreAllMocks());

function mockFetch(res: Response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

describe("harvestRequest", () => {
  it("injects the three required Harvest headers", async () => {
    const spy = mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await harvestRequest("users/me", { credentials: CREDS });
    const [, init] = spy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Harvest-Account-Id"]).toBe("123");
    expect(headers["User-Agent"]).toContain("harvest-axi");
  });

  it("parses a successful JSON body", async () => {
    mockFetch(new Response(JSON.stringify({ first_name: "Chris" }), { status: 200 }));
    const res = await harvestRequest<{ first_name: string }>("users/me", { credentials: CREDS });
    expect(res.first_name).toBe("Chris");
  });

  it("returns an empty object for an empty (e.g. DELETE) response", async () => {
    mockFetch(new Response("", { status: 200 }));
    const res = await harvestRequest("time_entries/1", { method: "DELETE", credentials: CREDS });
    expect(res).toEqual({});
  });

  it("translates 401 to TOKEN_INVALID without leaking the raw body", async () => {
    mockFetch(new Response("private server stack trace", { status: 401 }));
    await expect(harvestRequest("users/me", { credentials: CREDS })).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });

  it("translates 422 to VALIDATION_ERROR", async () => {
    mockFetch(new Response(JSON.stringify({ message: "task is required" }), { status: 422 }));
    await expect(
      harvestRequest("time_entries", { method: "POST", body: {}, credentials: CREDS }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("translates 429 to RATE_LIMITED carrying Retry-After", async () => {
    mockFetch(new Response("", { status: 429, headers: { "Retry-After": "12" } }));
    try {
      await harvestRequest("time_entries", { credentials: CREDS });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("RATE_LIMITED");
      expect((err as { suggestions: string[] }).suggestions.join(" ")).toContain("12");
    }
  });
});
