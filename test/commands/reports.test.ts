import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportsCommand } from "../../src/commands/reports.js";

function resultsPage(items: unknown[]): Response {
  return new Response(
    JSON.stringify({ results: items, page: 1, per_page: 2000, total_pages: 1, total_entries: items.length, links: { next: null } }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "tok");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("reports", () => {
  it("aggregates a projects report with totals and billable amount", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      resultsPage([
        { project_id: 1, project_name: "Alpha", client_name: "AcmeCo", total_hours: 10, billable_hours: 8, billable_amount: 1200, currency: "USD" },
        { project_id: 2, project_name: "Beta", client_name: "BetaCo", total_hours: 5, billable_hours: 5, billable_amount: 750, currency: "USD" },
      ]),
    );
    const out = await reportsCommand(["projects", "--this-month"]);
    expect(out).toContain("report: projects");
    expect(out).toContain("total_hours: 15");
    expect(out).toContain("billable_hours: 13");
    expect(out).toContain("billable_amount: 1950 USD");
    expect(out).toContain("projects[2]{project,client,hours,billable_hours,amount}:");
    expect(out).toMatch(/Alpha,AcmeCo,10,8,1200/);
    // hit the reports endpoint
    expect(String(spy.mock.calls[0]?.[0])).toContain("/reports/time/projects");
  });

  it("rejects a window longer than 365 days before any call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(
      reportsCommand(["clients", "--from", "2024-01-01", "--to", "2026-01-01"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unknown axis", async () => {
    await expect(reportsCommand(["widgets"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("discloses mixed currencies instead of summing them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      resultsPage([
        { client_id: 1, client_name: "US Co", total_hours: 4, billable_hours: 4, billable_amount: 400, currency: "USD" },
        { client_id: 2, client_name: "EU Co", total_hours: 2, billable_hours: 2, billable_amount: 300, currency: "EUR" },
      ]),
    );
    const out = await reportsCommand(["clients", "--this-month"]);
    expect(out).toContain("mixed currencies");
  });

  it("gives a definitive empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(resultsPage([]));
    const out = await reportsCommand(["tasks", "--today"]);
    expect(out).toContain("0 tasks with tracked time");
  });
});

describe("reports uninvoiced", () => {
  it("requires an explicit window before any call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(reportsCommand(["uninvoiced"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("aggregates uninvoiced hours/expenses/amount per project, sorted by amount", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      resultsPage([
        { project_id: 1, project_name: "Small", client_name: "AcmeCo", total_hours: 2, uninvoiced_hours: 2, uninvoiced_expenses: 0, uninvoiced_amount: 200, currency: "USD" },
        { project_id: 2, project_name: "Big", client_name: "BetaCo", total_hours: 10, uninvoiced_hours: 10, uninvoiced_expenses: 50, uninvoiced_amount: 1500, currency: "USD" },
      ]),
    );
    const out = await reportsCommand(["uninvoiced", "--from", "2026-05-01", "--to", "2026-05-31"]);
    expect(out).toContain("report: uninvoiced");
    expect(out).toContain("uninvoiced_amount: 1700 USD");
    expect(out).toContain("uninvoiced[2]{project,client,hours,uninvoiced_hours,expenses,amount}:");
    // Big ($1500) sorts before Small ($200)
    expect(out.indexOf("Big")).toBeLessThan(out.indexOf("Small"));
    expect(String(spy.mock.calls[0]?.[0])).toContain("/reports/uninvoiced");
  });

  it("reuses the 365-day span guard", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(
      reportsCommand(["uninvoiced", "--from", "2024-01-01", "--to", "2026-01-01"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("reports expenses", () => {
  it("aggregates an expenses axis with the right identity column and totals", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      resultsPage([
        { project_id: 1, project_name: "Alpha", client_name: "AcmeCo", total_amount: 100, billable_amount: 80, currency: "USD" },
        { project_id: 2, project_name: "Beta", client_name: "BetaCo", total_amount: 250, billable_amount: 250, currency: "USD" },
      ]),
    );
    const out = await reportsCommand(["expenses", "projects", "--this-month"]);
    expect(out).toContain("report: expenses projects");
    expect(out).toContain("total_amount: 350 USD");
    expect(out).toContain("expenses_projects[2]{project,client,total,billable}:");
    // Beta (250) sorts before Alpha (100)
    expect(out.indexOf("Beta")).toBeLessThan(out.indexOf("Alpha"));
    expect(String(spy.mock.calls[0]?.[0])).toContain("/reports/expenses/projects");
  });

  it("uses the category identity column for the categories axis", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      resultsPage([{ expense_category_id: 7, expense_category_name: "Travel", total_amount: 40, billable_amount: 40, currency: "USD" }]),
    );
    const out = await reportsCommand(["expenses", "categories", "--this-month"]);
    expect(out).toContain("expenses_categories[1]{category,total,billable}:");
    expect(out).toContain("Travel");
  });

  it("rejects an unknown expenses axis", async () => {
    await expect(reportsCommand(["expenses", "widgets"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("errors when expenses is given no axis", async () => {
    await expect(reportsCommand(["expenses"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("gives a definitive empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(resultsPage([]));
    const out = await reportsCommand(["expenses", "team", "--today"]);
    expect(out).toContain("0 expenses recorded");
  });
});

describe("reports budget", () => {
  it("snapshots projects sorted by remaining ascending, showing budget_by", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      resultsPage([
        { project_id: 1, project_name: "Healthy", client_name: "AcmeCo", budget_by: "project", budget: 100, budget_spent: 20, budget_remaining: 80, is_active: true },
        { project_id: 2, project_name: "OverBudget", client_name: "BetaCo", budget_by: "project_cost", budget: 100, budget_spent: 150, budget_remaining: -50, is_active: true },
      ]),
    );
    const out = await reportsCommand(["budget"]);
    expect(out).toContain("report: budget");
    expect(out).toContain("budget[2]{project,client,budget_by,budget,spent,remaining,active}:");
    // most at-risk (remaining -50) on top
    expect(out.indexOf("OverBudget")).toBeLessThan(out.indexOf("Healthy"));
    // active-only default → is_active=true filter on the query
    expect(String(spy.mock.calls[0]?.[0])).toContain("is_active=true");
    expect(String(spy.mock.calls[0]?.[0])).toContain("/reports/project_budget");
  });

  it("includes inactive with --all (no is_active filter)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(resultsPage([]));
    await reportsCommand(["budget", "--all"]);
    expect(String(spy.mock.calls[0]?.[0])).not.toContain("is_active");
  });

  it("rejects a date window (it's a snapshot) before any call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(reportsCommand(["budget", "--last-month"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });
});
