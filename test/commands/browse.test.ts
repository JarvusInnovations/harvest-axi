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

  it("lists users with name/email/roles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      listPage("users", [
        { id: 1, first_name: "Ada", last_name: "Lovelace", email: "ada@x.com", access_roles: ["administrator"], is_active: true },
      ]),
    );
    const out = await browseCommand(["users"]);
    expect(out).toContain("users[1]{id,name,email,roles,active}:");
    expect(out).toContain("Ada Lovelace");
    expect(out).toContain("administrator");
  });

  it("maps --since to updated_since on a list", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage("clients", [{ id: 1, name: "C", is_active: true }]));
    await browseCommand(["clients", "--since", "7d"]);
    expect(String(spy.mock.calls[0]?.[0])).toContain("updated_since=");
  });
});

describe("browse detail views", () => {
  it("shows a client's full record", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 7, name: "Caltrans", is_active: true, currency: "USD", address: "1 Main", statement_key: "abc", created_at: "x", updated_at: "y" }), { status: 200 }),
    );
    const out = await browseCommand(["clients", "7"]);
    expect(out).toContain("name: Caltrans");
    expect(out).toContain("currency: USD");
    expect(out).toContain("statement_key: abc");
  });

  it("renders user weekly_capacity in hours and resolves `me` via /users/me", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 9, first_name: "Chris", last_name: "A", email: "c@x.com", weekly_capacity: 126000, access_roles: ["administrator"], is_active: true }), { status: 200 }),
    );
    const out = await browseCommand(["users", "me"]);
    expect(String(spy.mock.calls[0]?.[0])).toContain("/users/me");
    expect(out).toContain("weekly_capacity_hours: 35");
  });

  it("folds task assignments into a project detail (the curl-gap closer)", async () => {
    // Numeric id skips name resolution → exactly two fetches: project + assignments.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 48, name: "API Test", code: null, client: { name: "Acme" }, is_active: true, is_billable: true, is_fixed_fee: false, bill_by: "Project", hourly_rate: 1, budget_by: "project_cost", cost_budget: 100, created_at: "x", updated_at: "y" }), { status: 200 }))
      .mockResolvedValueOnce(listPage("task_assignments", [
        { task: { name: "Development" }, billable: true, hourly_rate: null, is_active: true },
        { task: { name: "Design" }, billable: true, hourly_rate: null, is_active: true },
      ]));
    const out = await browseCommand(["projects", "48"]);
    expect(out).toContain("project:");
    expect(out).toContain("name: API Test");
    expect(out).toContain("tasks[2]{task,billable,hourly_rate,active}:");
    expect(out).toContain("Development");
    expect(out).toContain("Design");
  });

  it("translates a bad detail id into NOT_FOUND", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    );
    await expect(browseCommand(["tasks", "999999"])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
