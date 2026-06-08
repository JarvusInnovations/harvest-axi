import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paginateAll } from "../../src/harvest/paginate.js";

beforeEach(() => {
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "tok");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "123");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Build a Harvest-style page response. */
function page(items: unknown[], pageNo: number, totalPages: number, totalEntries: number) {
  return new Response(
    JSON.stringify({
      time_entries: items,
      page: pageNo,
      per_page: 2000,
      total_pages: totalPages,
      total_entries: totalEntries,
      links: { next: pageNo < totalPages ? `?page=${pageNo + 1}` : null },
    }),
    { status: 200 },
  );
}

describe("paginateAll", () => {
  it("follows pages to completion and reports complete:true with the right total", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], 1, 3, 5))
      .mockResolvedValueOnce(page([{ id: 3 }, { id: 4 }], 2, 3, 5))
      .mockResolvedValueOnce(page([{ id: 5 }], 3, 3, 5));

    const result = await paginateAll("time_entries", "time_entries");
    expect(result.items).toHaveLength(5);
    expect(result.total_entries).toBe(5);
    expect(result.complete).toBe(true);
    expect(result.pages_fetched).toBe(3);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("reports complete:false when the safety cap is hit before completion", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockImplementation(async () => page([{ id: 0 }], 1, 999, 999));
    const result = await paginateAll("time_entries", "time_entries", {}, 2);
    expect(result.complete).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns a single page when there is no next link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([{ id: 1 }], 1, 1, 1));
    const result = await paginateAll("time_entries", "time_entries");
    expect(result.items).toHaveLength(1);
    expect(result.complete).toBe(true);
  });
});
