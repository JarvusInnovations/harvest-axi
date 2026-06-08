import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browseCommand } from "../../src/commands/browse.js";

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

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "tok");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("browse", () => {
  it("lists active clients by default, filtering out archived", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      listPage("clients", [
        { id: 1, name: "Caltrans", is_active: true },
        { id: 2, name: "Old Co", is_active: false },
      ]),
    );
    const out = await browseCommand(["clients"]);
    expect(out).toContain("clients[1]{id,name,active}:");
    expect(out).toContain("Caltrans");
    expect(out).not.toContain("Old Co");
    expect(out).toContain("active_only: true");
  });

  it("includes archived with --all", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      listPage("clients", [
        { id: 1, name: "Caltrans", is_active: true },
        { id: 2, name: "Old Co", is_active: false },
      ]),
    );
    const out = await browseCommand(["clients", "--all"]);
    expect(out).toContain("clients[2]");
    expect(out).toContain("Old Co");
  });

  it("filters projects by --client name (resolved → client_id)", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(listPage("clients", [{ id: 5, name: "Caltrans" }])) // resolution
      .mockResolvedValueOnce(listPage("projects", [{ id: 9, name: "Proj", client: { name: "Caltrans" }, code: "C1", is_active: true }]));
    const out = await browseCommand(["projects", "--client", "Caltrans"]);
    expect(out).toContain("projects[1]{id,name,client,code,active}:");
    const projectsCall = spy.mock.calls.find(([url]) => String(url).includes("/projects"));
    expect(String(projectsCall?.[0])).toContain("client_id=5");
  });

  it("summarizes my project assignments with a compact task list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      listPage("project_assignments", [
        {
          is_active: true,
          project: { name: "GTFS Pathways" },
          client: { name: "Caltrans" },
          task_assignments: [{ task: { name: "Dev" } }, { task: { name: "PM" } }],
        },
      ]),
    );
    const out = await browseCommand(["mine"]);
    expect(out).toContain("assignments[1]{project,client,tasks}:");
    expect(out).toContain("GTFS Pathways");
    expect(out).toContain("Dev, PM");
  });

  it("gives a definitive empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage("tasks", []));
    const out = await browseCommand(["tasks"]);
    expect(out).toContain("0 active tasks found");
  });
});
