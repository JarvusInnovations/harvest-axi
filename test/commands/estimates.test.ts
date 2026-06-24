import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimatesCommand } from "../../src/commands/estimates.js";

const ESTIMATES = [
  { id: 1, number: "E-1001", state: "draft", amount: 1000, currency: "USD", issue_date: "2026-05-31", client: { id: 1, name: "Acme" } },
  { id: 2, number: "E-1000", state: "accepted", amount: 500, currency: "USD", issue_date: "2026-05-01", client: { id: 1, name: "Acme" } },
  { id: 3, number: "E-999", state: "sent", amount: 250, currency: "USD", issue_date: "2026-04-15", client: { id: 2, name: "Beta" } },
];

function listPage(items: unknown[], key = "estimates"): Response {
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

describe("estimates list", () => {
  it("rolls up by state with summed amount and complete:true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage(ESTIMATES));
    const out = await estimatesCommand([]);
    expect(out).toContain("total: 3");
    expect(out).toContain("draft: 1");
    expect(out).toContain("sent: 1");
    expect(out).toContain("accepted: 1");
    expect(out).toContain("declined: 0");
    expect(out).toContain("amount: 1750");
    expect(out).toContain("currency: USD");
    expect(out).toContain("complete: true");
    // No due column — estimates have no balance.
    expect(out).toContain("estimates[3]{id,number,client,state,amount,issue_date}:");
    expect(out).not.toContain("due");
    // Newest issue_date first.
    expect(out.indexOf("E-1001")).toBeLessThan(out.indexOf("E-1000"));
  });

  it("--drafts filters server-side via state=draft", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage([ESTIMATES[0]]));
    const out = await estimatesCommand(["--drafts"]);
    expect(out).toContain("scope: draft");
    expect(out).toContain("total: 1");
    expect(String(spy.mock.calls[0]?.[0])).toContain("state=draft");
  });

  it("rejects an unknown --state before any fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(estimatesCommand(["--state", "paid"])).rejects.toThrow(/Unknown --state/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("notes mixed currencies instead of summing", async () => {
    const mixed = [
      { ...ESTIMATES[0], currency: "USD" },
      { ...ESTIMATES[1], currency: "EUR" },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage(mixed));
    const out = await estimatesCommand([]);
    expect(out).toContain("mixed currencies — not summed");
  });

  it("gives a definitive empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage([]));
    const out = await estimatesCommand(["--state", "declined"]);
    expect(out).toContain("0 estimates found");
  });

  it("announces a --limit cap loudly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage(ESTIMATES));
    const out = await estimatesCommand(["--limit", "1"]);
    expect(out).toContain("Showing 1 of 3 matched estimates");
  });

  it("maps --since to updated_since and stamps the range", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage(ESTIMATES));
    await estimatesCommand(["--since", "7d"]);
    expect(String(spy.mock.calls[0]?.[0])).toContain("updated_since=");
  });

  it("translates a 403 into a FORBIDDEN error citing the manager role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    );
    await expect(estimatesCommand([])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves a client name then queries with client_id", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(listPage([{ id: 1, name: "Acme" }], "clients"))
      .mockResolvedValueOnce(listPage(ESTIMATES.filter((e) => e.client.id === 1)));
    const out = await estimatesCommand(["--client", "Acme"]);
    expect(out).toContain("client Acme");
    const listCall = spy.mock.calls.find(([url]) => String(url).includes("/estimates"));
    expect(String(listCall?.[0])).toContain("client_id=1");
  });
});

describe("estimates get", () => {
  const ESTIMATE = {
    id: 1, number: "E-1001", state: "draft", amount: 1000, currency: "USD",
    subject: "Phase 1", purchase_order: "PO-7", issue_date: "2026-05-31",
    tax: 5, tax_amount: 50, tax2: null, tax2_amount: null, discount: null, discount_amount: null,
    sent_at: null, accepted_at: null, declined_at: null,
    client_key: "abc123", client: { id: 1, name: "Acme" }, creator: { id: 9, name: "Chris" },
    line_items: [{ id: 11, kind: "Service", description: "Scoping", quantity: 10, unit_price: 100, amount: 1000, taxed: true }],
  };

  function configWithBaseUri(): void {
    const dir = join(process.env.XDG_CONFIG_HOME!, "harvest-axi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ version: 1, token: "tok", account_id: "1", profile_cache: { user_id: 9, user_name: "Chris", account_name: "Acme", base_uri: "https://acme.harvestapp.com", cached_at: "x" } }),
    );
  }

  it("renders all field groups, line items, messages, and composed public links", async () => {
    configWithBaseUri();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(ESTIMATE), { status: 200 }))
      .mockResolvedValueOnce(listPage([{ id: 8, sent_at: "2026-05-31T00:00:00Z", event_type: null, recipients: [{ email: "ap@acme.com" }], subject: "Estimate E-1001" }], "estimate_messages"));
    const out = await estimatesCommand(["get", "1"]);
    expect(out).toContain("subject: Phase 1");
    expect(out).toContain("tax_amount: 50");
    expect(out).toContain("accepted_at: —");
    expect(out).toContain("web: \"https://acme.harvestapp.com/client/estimates/abc123\"");
    expect(out).toContain("pdf: \"https://acme.harvestapp.com/client/estimates/abc123.pdf\"");
    // No project column on estimate line items.
    expect(out).toContain("line_items[1]{kind,description,quantity,unit_price,amount,taxed}:");
    expect(out).toContain("messages[1]{sent_at,event_type,recipients,subject}:");
    expect(out).toContain("ap@acme.com");
  });

  it("emits no due_amount and no references/payments blocks", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(ESTIMATE), { status: 200 }))
      .mockResolvedValueOnce(listPage([], "estimate_messages"));
    const out = await estimatesCommand(["get", "1"]);
    expect(out).not.toContain("due_amount");
    expect(out).not.toContain("payments");
    expect(out).not.toContain("references");
  });

  it("falls back to a client_key note when base_uri is uncached", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(ESTIMATE), { status: 200 }))
      .mockResolvedValueOnce(listPage([], "estimate_messages"));
    const out = await estimatesCommand(["get", "1"]);
    expect(out).toContain("client_key: abc123");
    expect(out).toContain("whoami --refresh");
  });

  it("--raw dumps the untranslated estimate without a messages call", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(ESTIMATE), { status: 200 }),
    );
    const out = await estimatesCommand(["get", "1", "--raw"]);
    expect(out).toContain("client_key: abc123");
    expect(spy).toHaveBeenCalledTimes(1); // no messages fetch under --raw
  });

  it("requires an id", async () => {
    await expect(estimatesCommand(["get"])).rejects.toThrow(/requires a numeric estimate id/);
  });
});
