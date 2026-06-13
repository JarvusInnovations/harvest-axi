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
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 7, name: "Caltrans", is_active: true, currency: "USD", address: "1 Main", statement_key: "abc", created_at: "x", updated_at: "y" }), { status: 200 }),
      )
      .mockResolvedValueOnce(listPage("contacts", [])); // detail folds in contacts (second fetch)
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

describe("browse contacts", () => {
  it("lists contacts, resolving --client to client_id", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(listPage("clients", [{ id: 5, name: "Caltrans" }])) // resolution
      .mockResolvedValueOnce(listPage("contacts", [
        { id: 1, first_name: "Ada", last_name: "Byron", email: "ada@x.com", phone_office: "555-1", client: { name: "Caltrans" } },
      ]));
    const out = await browseCommand(["contacts", "--client", "Caltrans"]);
    expect(out).toContain("contacts[1]{id,name,client,email,phone}:");
    expect(out).toContain("Ada Byron");
    const contactsCall = spy.mock.calls.find(([url]) => String(url).includes("/contacts"));
    expect(String(contactsCall?.[0])).toContain("client_id=5");
  });

  it("shows a contact's full record by numeric id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 9, first_name: "Ada", last_name: "Byron", title: "AP", email: "ada@x.com", phone_office: "555-1", client: { name: "Caltrans" }, invoice_recipient_status: "recipient" }), { status: 200 }),
    );
    const out = await browseCommand(["contacts", "9"]);
    expect(out).toContain("name: Ada Byron");
    expect(out).toContain("invoice_recipient_status: recipient");
  });

  it("rejects a non-numeric contact id (contacts aren't name-resolved)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(browseCommand(["contacts", "Ada"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("folds a client's contacts into client detail", async () => {
    // numeric id → no resolution: client GET + contacts list.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 5, name: "Caltrans", is_active: true, currency: "USD", statement_key: "k", created_at: "x", updated_at: "y" }), { status: 200 }))
      .mockResolvedValueOnce(listPage("contacts", [
        { id: 1, first_name: "Ada", last_name: "Byron", title: "AP", email: "ada@x.com", phone_office: "555-1" },
      ]));
    const out = await browseCommand(["clients", "5"]);
    expect(out).toContain("client:");
    expect(out).toContain("contacts[1]{name,title,email,phone}:");
    expect(out).toContain("Ada Byron");
  });

  it("notes when a client has no contacts", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 5, name: "Caltrans", is_active: true, currency: "USD", statement_key: "k", created_at: "x", updated_at: "y" }), { status: 200 }))
      .mockResolvedValueOnce(listPage("contacts", []));
    const out = await browseCommand(["clients", "5"]);
    expect(out).toContain("no contacts on this client");
  });
});
