import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entriesCommand } from "../../src/commands/entries.js";
import { writeConfig } from "../../src/config.js";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status });
}

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "");
  // Seed config: duration-mode account, known self user id.
  writeConfig({
    version: 1,
    account_id: "1",
    token: "tok",
    default_user_id: 42,
    profile_cache: {
      user_id: 42,
      user_name: "Chris",
      account_name: "Jarvus",
      wants_timestamp_timers: false,
      cached_at: "2026-06-08T00:00:00Z",
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("entries log", () => {
  it("creates a duration entry and returns its id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({ id: 999, spent_date: "2026-06-08", project: { name: "GTFS" }, task: { name: "Dev" }, hours: 1.5, is_running: false }),
    );
    const out = await entriesCommand(["log", "--project", "10", "--task", "20", "--hours", "1.5", "--notes", "x"]);
    expect(out).toContain("logged");
    expect(out).toContain("999");
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ project_id: 10, task_id: 20, hours: 1.5, notes: "x" });
    expect(body.spent_date).toBeTruthy(); // defaulted to today
  });

  it("requires --project and --task", async () => {
    await expect(entriesCommand(["log", "--hours", "1"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects --started in a duration-mode account (no network)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(
      entriesCommand(["log", "--project", "10", "--task", "20", "--started", "9:00am"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled(); // failed fast, before any lookup
  });
});

describe("entries edit / delete", () => {
  it("PATCHes only the supplied fields", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ id: 5, spent_date: "2026-06-08", hours: 2, notes: "new" }));
    await entriesCommand(["edit", "5", "--notes", "new"]);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/time_entries/5");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ notes: "new" });
  });

  it("rejects an edit with no fields", async () => {
    await expect(entriesCommand(["edit", "5"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("deletes an entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    const out = await entriesCommand(["delete", "5"]);
    expect(out).toContain("deleted");
  });

  it("treats deleting an absent entry as a no-op (exit 0)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));
    const out = await entriesCommand(["delete", "5"]);
    expect(out).toContain("no-op");
  });
});

describe("entries timers", () => {
  it("stops a running entry", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ id: 7, is_running: true })) // GET current
      .mockResolvedValueOnce(json({ id: 7, is_running: false, hours: 0.25 })); // stop
    const out = await entriesCommand(["stop", "7"]);
    expect(out).toContain("stopped");
  });

  it("is a no-op when stopping an already-stopped entry", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ id: 7, is_running: false }));
    const out = await entriesCommand(["stop", "7"]);
    expect(out).toContain("already stopped (no-op)");
    expect(spy).toHaveBeenCalledTimes(1); // only the GET, no stop call
  });

  it("is a no-op when starting an already-running entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ id: 7, is_running: true }));
    const out = await entriesCommand(["start", "7"]);
    expect(out).toContain("already running (no-op)");
  });
});

describe("entries get / today", () => {
  it("shows full detail with complete notes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({ id: 5, spent_date: "2026-06-08", project: { name: "GTFS" }, task: { name: "Dev" }, hours: 2, notes: "a".repeat(300) }),
    );
    const out = await entriesCommand(["get", "5"]);
    expect(out).toContain("a".repeat(300)); // not truncated
  });

  it("requires a numeric id for get", async () => {
    await expect(entriesCommand(["get", "abc"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lists today's entries with a daily total", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          time_entries: [{ id: 1, project: { name: "GTFS" }, task: { name: "Dev" }, hours: 2, notes: "x", is_running: false }],
          page: 1, per_page: 2000, total_pages: 1, total_entries: 1, links: { next: null },
        }),
        { status: 200 },
      ),
    );
    const out = await entriesCommand(["today"]);
    expect(out).toContain("entries[1]{id,project,task,hours,notes,running}:");
    expect(out).toContain("total_hours: 2");
  });
});
