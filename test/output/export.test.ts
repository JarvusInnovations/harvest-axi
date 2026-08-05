/**
 * specs/behaviors/machine-output.md.
 *
 * The load-bearing assertions here are the ones that are easy to get subtly
 * wrong and silently ship: stdout must not change, the file must ignore the
 * display cap, and the printed `jq` example must actually run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entriesCommand } from "../../src/commands/entries.js";
import { invoicesCommand } from "../../src/commands/invoices.js";
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
    cost_rate: 75,
    notes: "spec review, with a comma",
    user: { id: 1, name: "Chris" },
    project: { id: 10, name: "Acme" },
    task: { id: 100, name: "Dev" },
    client: { id: 1, name: "AcmeCo" },
  },
  {
    id: 2,
    spent_date: "2026-06-09",
    hours: 3,
    rounded_hours: 3.25,
    billable: true,
    is_billed: false,
    is_running: false,
    billable_rate: 150,
    cost_rate: 75,
    notes: "standup",
    user: { id: 1, name: "Chris" },
    project: { id: 10, name: "Acme" },
    task: { id: 101, name: "PM" },
    client: { id: 1, name: "AcmeCo" },
  },
];

const INVOICES = [
  {
    id: 100,
    number: "INV-1",
    amount: 1000,
    due_amount: 0,
    currency: "USD",
    issue_date: "2026-05-01",
    due_date: "2026-05-31",
    state: "paid",
    paid_amount: 1000,
    client: { id: 1, name: "AcmeCo" },
  },
  {
    id: 101,
    number: "INV-2",
    amount: 500,
    due_amount: 500,
    currency: "USD",
    issue_date: "2026-06-01",
    due_date: "2026-06-30",
    state: "open",
    client: { id: 1, name: "AcmeCo" },
  },
];

const page = (key: string, items: unknown[]) => () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        [key]: items,
        page: 1,
        per_page: 2000,
        total_pages: 1,
        total_entries: items.length,
        links: { next: null },
      }),
      { status: 200 },
    ),
  );

beforeEach(() => {
  vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "harvest-axi-")));
  vi.stubEnv("HARVEST_ACCESS_TOKEN", "tok");
  vi.stubEnv("HARVEST_ACCOUNT_ID", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Pull the written path out of the `wrote:` line. */
function wrotePath(out: string): string {
  const m = /wrote: "?(\S+?)"? \(/.exec(out);
  if (!m) throw new Error(`no wrote: line in\n${out}`);
  return m[1];
}

describe("entries list --json-out", () => {
  it("leaves stdout unchanged apart from the appended description", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const plain = await entriesCommand(["list", "--team"]);
    const exported = await entriesCommand(["list", "--team", "--json-out"]);
    // The TOON view is byte-identical; the export only appends.
    expect(exported.startsWith(plain)).toBe(true);
    expect(exported.slice(plain.length)).toMatch(/wrote:/);
  });

  it("writes an auto path under the OS temp dir at 0600", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const out = await entriesCommand(["list", "--team", "--json-out"]);
    const path = wrotePath(out);
    // Ephemeral scratch belongs where the OS prunes — never ~/.config.
    expect(path.startsWith(join(tmpdir(), "harvest-axi"))).toBe(true);
    expect(path).not.toContain(".config");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("honours an explicit =path", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const target = join(mkdtempSync(join(tmpdir(), "exp-")), "entries.json");
    const out = await entriesCommand(["list", "--team", `--json-out=${target}`]);
    expect(out).toContain(target);
    expect(JSON.parse(readFileSync(target, "utf-8")).entries).toHaveLength(2);
  });

  it("echoes columns and a jq example that actually runs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const out = await entriesCommand(["list", "--team", "--json-out"]);
    expect(out).toContain("columns:");
    expect(out).toContain("rounded_hours");

    // The help line must be runnable as-is, not merely plausible.
    const jq = /Run `jq ('.*?') (\S+?)`/.exec(out);
    expect(jq).not.toBeNull();
    const result = execFileSync("jq", [jq![1].slice(1, -1), jq![2]], { encoding: "utf-8" });
    expect(Number(result.trim())).toBeCloseTo(5.5); // 2.25 + 3.25 billable rounded
  });

  it("the file ignores --limit while stdout stays capped", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const out = await entriesCommand(["list", "--team", "--limit", "1", "--json-out"]);
    expect(out).toContain("Showing 1 of 2 matched entries");
    // Silently truncating a script's data is the failure this feature exists
    // to avoid.
    expect(JSON.parse(readFileSync(wrotePath(out), "utf-8")).entries).toHaveLength(2);
  });

  it("carries both hours and rounded_hours regardless of --rounded", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    for (const extra of [[], ["--rounded"]]) {
      const out = await entriesCommand(["list", "--team", ...extra, "--json-out"]);
      const [first] = JSON.parse(readFileSync(wrotePath(out), "utf-8")).entries;
      expect(first.hours).toBe(2.004);
      expect(first.rounded_hours).toBe(2.25);
    }
  });

  it("keeps nested entities as {id, name} in JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const out = await entriesCommand(["list", "--team", "--json-out"]);
    const [first] = JSON.parse(readFileSync(wrotePath(out), "utf-8")).entries;
    expect(first.project).toEqual({ id: 10, name: "Acme" });
  });

  it("writes a valid empty payload when nothing matched", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", []));
    const out = await entriesCommand(["list", "--team", "--json-out"]);
    expect(JSON.parse(readFileSync(wrotePath(out), "utf-8")).entries).toEqual([]);
  });
});

describe("entries list --csv-out", () => {
  it("flattens nested entities to name + _id and escapes commas", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const out = await entriesCommand(["list", "--team", "--csv-out"]);
    const csv = readFileSync(wrotePath(out), "utf-8");
    const [header, firstRow] = csv.trim().split("\n");
    expect(header).toContain("project,project_id");
    expect(firstRow).toContain("Acme,10");
    expect(firstRow).toContain('"spec review, with a comma"');
  });
});

describe("entries get / today", () => {
  it("exports a single record as a one-element entries array", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(ENTRIES[0]), { status: 200 })),
    );
    const out = await entriesCommand(["get", "1", "--json-out"]);
    // One jq idiom works across every surface.
    const payload = JSON.parse(readFileSync(wrotePath(out), "utf-8"));
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].id).toBe(1);
  });

  it("today exports too", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("time_entries", ENTRIES));
    const out = await entriesCommand(["today", "--json-out"]);
    expect(JSON.parse(readFileSync(wrotePath(out), "utf-8")).entries).toHaveLength(2);
  });
});

describe("invoices --json-out", () => {
  it("payload sums to the amount the TOON header reports", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("invoices", INVOICES));
    const out = await invoicesCommand(["--json-out"]);
    expect(out).toContain("amount: 1500");
    const total = JSON.parse(readFileSync(wrotePath(out), "utf-8")).invoices.reduce(
      (s: number, i: { amount: number }) => s + i.amount,
      0,
    );
    expect(total).toBe(1500);
  });

  it("prints a jq example that runs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(page("invoices", INVOICES));
    const out = await invoicesCommand(["--json-out"]);
    const jq = /Run `jq ('.*?') (\S+?)`/.exec(out);
    expect(jq).not.toBeNull();
    const result = execFileSync("jq", [jq![1].slice(1, -1), jq![2]], { encoding: "utf-8" });
    expect(Number(result.trim())).toBe(1500);
  });
});

describe("export flag guards", () => {
  it("two export flags at once exit 2", async () => {
    await expect(entriesCommand(["list", "--json-out", "--csv-out"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("an empty =path is rejected", async () => {
    await expect(entriesCommand(["list", "--json-out="])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("writes reject the flags rather than accepting them inertly", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(entriesCommand(["log", "--json-out"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(invoicesCommand(["create", "--json-out"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("review is not an export surface at any axis, and says where to go", async () => {
    for (const args of [["--json-out"], ["--by", "none", "--json-out"]]) {
      const err = (await reviewCommand(args).catch((e: Error) => e)) as Error & {
        suggestions?: string[];
      };
      expect(err.message).toMatch(/not supported on `review`/);
      // The redirect matters as much as the rejection.
      expect((err.suggestions ?? []).join(" ")).toContain("entries list");
    }
  });
});
