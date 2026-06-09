import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homeCommand } from "../../src/commands/home.js";
import { writeConfig } from "../../src/config.js";

function entriesPage(items: unknown[]): Response {
  return new Response(JSON.stringify({ time_entries: items, page: 1, per_page: 50, total_pages: 1, total_entries: items.length, links: { next: null } }), { status: 200 });
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function configure() {
  writeConfig({
    version: 1,
    account_id: "1",
    token: "tok",
    default_user_id: 42,
    profile_cache: { user_id: 42, user_name: "Chris", account_name: "Jarvus", cached_at: "2026-06-08T00:00:00Z" },
  });
}

describe("home", () => {
  it("prompts setup when unconfigured", async () => {
    const out = await homeCommand();
    expect(out).toContain("no Harvest credentials");
  });

  it("surfaces an active timer, today summary, last entry, and recent 3 — in one API call", async () => {
    configure();
    const t = todayStr();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      entriesPage([
        { id: 1, spent_date: t, hours: 0.5, is_running: true, project: { name: "GTFS" }, task: { name: "PM" } },
        { id: 2, spent_date: t, hours: 2, is_running: false, project: { name: "GTFS" }, task: { name: "Dev" } },
        { id: 3, spent_date: "2026-06-01", hours: 1, is_running: false, project: { name: "Acme" }, task: { name: "Mtg" } },
        { id: 4, spent_date: "2026-05-30", hours: 3, is_running: false, project: { name: "Acme" }, task: { name: "Dev" } },
      ]),
    );
    const out = await homeCommand();
    expect(spy).toHaveBeenCalledTimes(1); // one API call
    expect(out).toContain("active_timer: GTFS / PM — 0.5h elapsed");
    expect(out).toContain("today: 2.5h across 2 entries"); // 0.5 + 2, both today
    expect(out).toMatch(/last_entry: .*\(today\)/);
    expect(out).toContain("recent[3]{spent_date,project,task,hours}:");
  });

  it("renders the help block multi-line ending with the --help discovery line", async () => {
    configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(entriesPage([]));
    const out = await homeCommand();
    expect(out).toMatch(/help\[\d\]:\n {2}Run/); // multi-line block, not inline
    expect(out).toContain("Run `harvest-axi --help` to see the full command list");
  });

  it("omits active_timer when nothing is running", async () => {
    configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      entriesPage([{ id: 1, spent_date: "2026-06-01", hours: 1, is_running: false, project: { name: "Acme" }, task: { name: "Mtg" } }]),
    );
    const out = await homeCommand();
    expect(out).not.toContain("active_timer:");
    expect(out).toContain("today: nothing logged yet"); // 2026-06-01 isn't today
    expect(out).toContain("last_entry: 2026-06-01");
  });

  it("degrades gracefully when the live call fails", async () => {
    configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));
    const out = await homeCommand();
    expect(out).toContain("account: Jarvus"); // identity still rendered
    expect(out).not.toContain("recent[");
    expect(out).toContain("help[");
  });
});
