/**
 * specs/behaviors/flag-validation.md — command-level coverage.
 *
 * Every case asserts `fetch` was never called: validation must run before any
 * Harvest request, so a bad flag costs nothing and can't half-execute.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewCommand } from "../../src/commands/review.js";
import { entriesCommand } from "../../src/commands/entries.js";
import { invoicesCommand } from "../../src/commands/invoices.js";
import { estimatesCommand } from "../../src/commands/estimates.js";
import { reportsCommand } from "../../src/commands/reports.js";
import { browseCommand } from "../../src/commands/browse.js";

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "tok");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Assert the command rejects, and that it never reached the network. */
async function rejects(fn: () => Promise<unknown>, ...contains: string[]) {
  const spy = vi.spyOn(globalThis, "fetch");
  await expect(fn()).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(spy).not.toHaveBeenCalled();
  if (contains.length) {
    const err = await fn().catch((e: Error) => e);
    const text = `${err.message} ${JSON.stringify((err as { suggestions?: string[] }).suggestions)}`;
    for (const c of contains) expect(text).toContain(c);
  }
}

describe("unknown flags fail loud", () => {
  it("review rejects an unknown flag and lists valid ones", async () => {
    await rejects(() => reviewCommand(["--stat", "closed"]), "--stat", "--by");
  });

  it("entries validates per subcommand, not a merged set", async () => {
    // --billable is a review flag; it is not valid on `entries log`.
    await rejects(() => entriesCommand(["log", "--billable"]), "entries log", "--billable");
  });

  it("invoices list rejects an unknown flag", async () => {
    await rejects(() => invoicesCommand(["--stat", "draft"]), "--stat");
  });

  it("invoices create rejects an unknown flag", async () => {
    await rejects(() => invoicesCommand(["create", "--clientt", "Acme"]), "--clientt");
  });

  it("estimates rejects an unknown flag", async () => {
    await rejects(() => estimatesCommand(["--projekt", "X"]), "--projekt");
  });

  it("reports rejects an unknown flag", async () => {
    await rejects(() => reportsCommand(["projects", "--bogus"]), "--bogus");
  });

  it("browse rejects an unknown flag", async () => {
    await rejects(() => browseCommand(["projects", "--bogus"]), "--bogus");
  });
});

describe("stray positionals fail loud", () => {
  it("review takes flags only", async () => {
    await rejects(() => reviewCommand(["bogus"]), "bogus");
  });

  it("a mistyped invoices subcommand is not silently a list", async () => {
    await rejects(() => invoicesCommand(["detail", "123"]), "detail", "get");
  });

  it("a report that takes no axis rejects one", async () => {
    await rejects(() => reportsCommand(["uninvoiced", "by-category"]), "by-category");
  });
});

describe("renamed and removed flags get targeted hints", () => {
  it("--raw points at --json-out", async () => {
    await rejects(() => invoicesCommand(["get", "123", "--raw"]), "--json-out");
    await rejects(() => estimatesCommand(["get", "123", "--raw"]), "--json-out");
  });

  it("--json points at --json-out", async () => {
    await rejects(() => reviewCommand(["--json"]), "--json-out[=path]");
  });
});

describe("export flags are rejected where they do not act", () => {
  it("review names the exporting surfaces instead", async () => {
    await rejects(() => reviewCommand(["--json-out"]), "entries list", "invoices");
  });

  it("review --by none is not an export surface either", async () => {
    await rejects(() => reviewCommand(["--by", "none", "--csv-out"]), "entries list");
  });

  it("reports and estimates reject them too", async () => {
    await rejects(() => reportsCommand(["projects", "--json-out"]), "not supported");
    await rejects(() => estimatesCommand(["--json-out"]), "not supported");
  });
});

describe("constrained flag values list their vocabulary", () => {
  it("review --approval", async () => {
    await rejects(() => reviewCommand(["--approval", "bogus"]), "unsubmitted, submitted, approved");
  });

  it("review --by", async () => {
    await rejects(() => reviewCommand(["--by", "bogus"]), "user, project");
  });

  it("invoices --state", async () => {
    await rejects(() => invoicesCommand(["--state", "bogus"]), "draft, open, paid, closed");
  });
});

describe("valid input still parses", () => {
  it("named windows are real flags on every range-taking command", async () => {
    // Reaching the network means the flag parsed; the fetch itself is stubbed.
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          time_entries: [],
          page: 1,
          per_page: 2000,
          total_pages: 1,
          total_entries: 0,
          links: { next: null },
        }),
        { status: 200 },
      ),
    );
    await reviewCommand(["--team", "--last-month"]);
    expect(spy).toHaveBeenCalled();
  });

  it("accepts the --name=value form", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          time_entries: [],
          page: 1,
          per_page: 2000,
          total_pages: 1,
          total_entries: 0,
          links: { next: null },
        }),
        { status: 200 },
      ),
    );
    await reviewCommand(["--team", "--limit=5"]);
    expect(spy).toHaveBeenCalled();
  });
});
