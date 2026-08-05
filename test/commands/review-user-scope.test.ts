/**
 * Regression coverage for #14 — `review --user <id>` silently returning
 * whole-team totals.
 *
 * The cause was precedence, not parsing: `--user` was parsed, resolved, and
 * wired into the query, but `if (flags.team) … else if (user)` let `--team`
 * win whenever both were passed — which every repro in the issue did. These
 * tests pin the repro shape so the precedence can't silently return.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewCommand } from "../../src/commands/review.js";

const ENTRY = (id: number, userId: number, hours: number) => ({
  id,
  spent_date: "2026-06-08",
  hours,
  billable: true,
  is_running: false,
  user: { id: userId, name: `User${userId}` },
  project: { id: 10, name: "Acme" },
  task: { id: 100, name: "Dev" },
  client: { id: 1, name: "AcmeCo" },
});

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

describe("review user scope (#14)", () => {
  it("rejects --team with --user before any API call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    // The exact shape of every repro in the issue.
    await expect(
      reviewCommand(["--team", "--user", "42", "--from", "2026-06-01", "--to", "2026-06-30"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("names both flags and offers both alternatives", async () => {
    const err = await reviewCommand(["--team", "--user", "42"]).catch((e: Error) => e);
    expect(err.message).toContain("--team");
    expect(err.message).toContain("--user");
    const help = ((err as { suggestions?: string[] }).suggestions ?? []).join(" ");
    expect(help).toContain("--user <id|name>` alone");
    expect(help).toContain("--team --by user");
  });

  it("scopes to the requested user, not the team", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pageOf([ENTRY(1, 42, 3)]));
    const out = await reviewCommand(["--user", "42", "--from", "2026-06-01", "--to", "2026-06-30"]);
    expect(String(spy.mock.calls[0]?.[0])).toContain("user_id=42");
    expect(out).toContain("total_hours: 3");
    expect(out).toContain("scope: user");
  });

  it("distinct user ids yield distinct totals — the issue's inverted repro", async () => {
    // Previously all three returned the identical whole-team total.
    const byUser: Record<string, number> = { "42": 3, "43": 5, "44": 8 };
    const totals: number[] = [];
    for (const [id, hours] of Object.entries(byUser)) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        pageOf([ENTRY(Number(id), Number(id), hours)]),
      );
      const out = await reviewCommand(["--user", id, "--from", "2026-06-01", "--to", "2026-06-30"]);
      totals.push(Number(/total_hours: ([\d.]+)/.exec(out)?.[1]));
      vi.restoreAllMocks();
    }
    expect(totals).toEqual([3, 5, 8]);
    expect(new Set(totals).size).toBe(3);
  });

  it("--team alone is unchanged", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(pageOf([ENTRY(1, 42, 3), ENTRY(2, 43, 5)]));
    const out = await reviewCommand(["--team", "--this-month"]);
    expect(String(spy.mock.calls[0]?.[0])).not.toContain("user_id=");
    expect(out).toContain("scope: team");
    expect(out).toContain("total_hours: 8");
  });
});
