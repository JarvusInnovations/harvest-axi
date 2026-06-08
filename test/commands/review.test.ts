import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewCommand } from "../../src/commands/review.js";

const ENTRIES = [
  { id: 1, spent_date: "2026-06-08", hours: 2, billable: true, is_running: false, user: { id: 1, name: "Chris" }, project: { id: 10, name: "Acme" }, task: { id: 100, name: "Dev" }, client: { id: 1, name: "AcmeCo" } },
  { id: 2, spent_date: "2026-06-09", hours: 3, billable: false, is_running: false, user: { id: 1, name: "Chris" }, project: { id: 10, name: "Acme" }, task: { id: 101, name: "PM" }, client: { id: 1, name: "AcmeCo" } },
  { id: 3, spent_date: "2026-06-09", hours: 1.5, billable: true, is_running: false, user: { id: 2, name: "Jane" }, project: { id: 11, name: "Beta" }, task: { id: 100, name: "Dev" }, client: { id: 2, name: "BetaCo" } },
];

function pageOf(items: unknown[]): Response {
  return new Response(
    JSON.stringify({
      time_entries: items,
      page: 1,
      per_page: 2000,
      total_pages: 1,
      total_entries: items.length,
      links: { next: null },
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "tok");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("review", () => {
  it("rolls up team entries by user with totals and complete:true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await reviewCommand(["--team", "--this-week"]);
    expect(out).toContain("scope: team");
    expect(out).toContain("total_hours: 6.5");
    expect(out).toContain("billable_hours: 3.5");
    expect(out).toContain("non_billable_hours: 3");
    expect(out).toContain("entries: 3");
    expect(out).toContain("complete: true");
    expect(out).toContain("by_user[2]{user,hours,billable,entries}:");
    // Chris sorts first (5 > 1.5).
    expect(out).toMatch(/Chris,5,2,2/);
    expect(out).toMatch(/Jane,1\.5,1\.5,1/);
  });

  it("regroups by project with --by project", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await reviewCommand(["--team", "--by", "project"]);
    expect(out).toContain("by_project[2]{project,hours,billable,entries}:");
    expect(out).toMatch(/Acme,5,/);
    expect(out).toMatch(/Beta,1\.5,/);
  });

  it("lists raw rows under --by none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await reviewCommand(["--team", "--by", "none"]);
    expect(out).toContain("entries[3]{id,spent_date,user,project,task,hours}:");
    expect(out).toContain("entries get <id>");
  });

  it("filters to billable entries client-side", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await reviewCommand(["--team", "--billable"]);
    expect(out).toContain("entries: 2"); // id 1 and 3
    expect(out).toContain("total_hours: 3.5");
    expect(out).toContain("complete: true"); // client-side filter doesn't make it partial
  });

  it("gives a definitive empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf([]));
    const out = await reviewCommand(["--team", "--today"]);
    expect(out).toContain("0 entries found");
  });

  it("defers name-based scope to the browse plan", async () => {
    await expect(reviewCommand(["--project", "Acme"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("discloses when --team returns only one user's entries (non-manager token)", async () => {
    // All entries belong to a single user despite asking for the team.
    const oneUser = ENTRIES.map((e) => ({ ...e, user: { id: 1, name: "Chris" } }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(oneUser));
    const out = await reviewCommand(["--team", "--this-week"]);
    expect(out).toContain("note:");
    expect(out).toContain("manager/admin role");
  });
});
