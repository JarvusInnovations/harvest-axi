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

describe("export-flag recognition is form-independent (#19)", () => {
  // The bug was that one form of one flag took a different code path, so the
  // matrix {bare, =path} × {command} is the regression surface.
  const NON_EXPORTING: [string, (a: string[]) => Promise<unknown>][] = [
    ["review", (a) => reviewCommand(a)],
    ["reports", (a) => reportsCommand(["projects", ...a])],
    ["estimates", (a) => estimatesCommand(a)],
    ["browse", (a) => browseCommand(["projects", ...a])],
    ["invoices get", (a) => invoicesCommand(["get", "1", ...a])],
    ["estimates get", (a) => estimatesCommand(["get", "1", ...a])],
  ];

  for (const [label, run] of NON_EXPORTING) {
    for (const token of ["--json-out", "--json-out=/tmp/x.json", "--csv-out=/tmp/x.csv"]) {
      it(`${label} redirects ${token} instead of calling it unknown`, async () => {
        const spy = vi.spyOn(globalThis, "fetch");
        const err = (await run([token]).catch((e: Error) => e)) as Error & {
          suggestions?: string[];
        };
        expect(err.message).not.toMatch(/Unknown flag/);
        expect(err.message).toMatch(/not supported on/);
        expect((err.suggestions ?? []).join(" ")).toContain("entries list");
        expect(spy).not.toHaveBeenCalled();
      });
    }
  }

  it("no unknown-flag error advertises a flag that command rejects", async () => {
    const err = (await reviewCommand(["--nope"]).catch((e: Error) => e)) as Error & {
      suggestions?: string[];
    };
    expect((err.suggestions ?? []).join(" ")).not.toContain("--json-out");
  });
});

describe("the space form names the = form (#19 nit)", () => {
  it("on an export surface", async () => {
    const err = (await entriesCommand(["list", "--json-out", "/tmp/y.json"]).catch(
      (e: Error) => e,
    )) as Error & { suggestions?: string[] };
    expect(err.message).toMatch(/attached with/);
    expect((err.suggestions ?? []).join(" ")).toContain("--json-out=/tmp/y.json");
  });

  it("but a bare id after the flag is not mistaken for a path", async () => {
    // `entries get --json-out 123` must keep working — the id is the positional.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 123, spent_date: "2026-06-08" }), {
          status: 200,
        }),
      ),
    );
    const out = await entriesCommand(["get", "--json-out", "123"]);
    expect(out).toContain("id: 123");
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
