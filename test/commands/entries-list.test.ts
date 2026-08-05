import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entriesCommand } from "../../src/commands/entries.js";
import { reviewCommand } from "../../src/commands/review.js";

const ENTRIES = [
  {
    id: 1,
    spent_date: "2026-06-08",
    hours: 2.004,
    rounded_hours: 2.25,
    billable: true,
    is_billed: false,
    is_running: false,
    billable_rate: 150,
    notes: "spec review",
    approval_status: "approved",
    user: { id: 1, name: "Chris" },
    project: { id: 10, name: "Acme" },
    task: { id: 100, name: "Dev" },
    client: { id: 1, name: "AcmeCo" },
  },
  {
    id: 2,
    spent_date: "2026-06-09",
    hours: 3,
    rounded_hours: 3,
    billable: false,
    is_billed: false,
    is_running: false,
    billable_rate: null,
    notes: "standup",
    approval_status: "submitted",
    user: { id: 1, name: "Chris" },
    project: { id: 10, name: "Acme" },
    task: { id: 101, name: "PM" },
    client: { id: 1, name: "AcmeCo" },
  },
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

describe("entries list", () => {
  it("renders a stamped header and row-first output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await entriesCommand(["list", "--team", "--this-month"]);
    expect(out).toContain("range:");
    expect(out).toContain("scope: team");
    expect(out).toContain("total_hours: 5");
    expect(out).toContain("entries: 2");
    expect(out).toContain("complete: true");
    expect(out).toContain("entries[2]{id,spent_date,user,project,task,hours}:");
  });

  it("returns the same entry ids as review --by none over the same window", async () => {
    // Proves both commands share one query path rather than each building one.
    // A Response body reads once, so build a fresh one per call.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(pageOf(ENTRIES)));
    const args = ["--team", "--project", "10", "--from", "2026-06-01", "--to", "2026-06-30"];
    const list = await entriesCommand(["list", ...args]);
    const review = await reviewCommand([...args, "--by", "none"]);
    const ids = (s: string) => [...s.matchAll(/^\s{2}(\d+),/gm)].map((m) => m[1]);
    expect(ids(list)).toEqual(["1", "2"]);
    expect(ids(list)).toEqual(ids(review));
  });

  it("carries the resolved scope into the query", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf([ENTRIES[0]]));
    await entriesCommand(["list", "--user", "42", "--project", "10", "--unbilled"]);
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain("user_id=42");
    expect(url).toContain("project_id=10");
    expect(url).toContain("is_billed=false");
  });

  it("--rounded swaps the displayed hours column", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf([ENTRIES[0]]));
    const out = await entriesCommand(["list", "--team", "--rounded"]);
    expect(out).toContain("total_hours: 2.25");
  });

  it("--fields adds the requested columns", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await entriesCommand(["list", "--team", "--fields", "rounded_hours,billable_rate"]);
    expect(out).toContain("rounded_hours");
    expect(out).toContain("billable_rate");
  });

  it("rejects an unknown --fields column", async () => {
    await expect(entriesCommand(["list", "--team", "--fields", "bogus"])).rejects.toThrow(
      /Unknown --fields column/,
    );
  });

  it("filters --billable client-side", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await entriesCommand(["list", "--team", "--billable"]);
    expect(out).toContain("entries: 1");
  });

  it("announces the --limit cap loudly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await entriesCommand(["list", "--team", "--limit", "1"]);
    expect(out).toContain("Showing 1 of 2 matched entries");
  });

  it("gives a definitive empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf([]));
    const out = await entriesCommand(["list", "--team"]);
    expect(out).toContain("0 entries found in");
    expect(out).toContain("Broaden the window");
  });

  it("rejects --team with --user, like review", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(entriesCommand(["list", "--team", "--user", "42"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unknown flag", async () => {
    await expect(entriesCommand(["list", "--bogus"])).rejects.toThrow(
      /Unknown flag --bogus for `entries list`/,
    );
  });
});

describe("review hands off to entries list", () => {
  it("suggests the export surface after --by none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf(ENTRIES));
    const out = await reviewCommand(["--team", "--by", "none"]);
    expect(out).toContain("entries list --json-out");
  });
});
