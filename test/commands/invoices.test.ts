import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoicesCommand } from "../../src/commands/invoices.js";

const INVOICES = [
  { id: 1, number: "1001", state: "draft", amount: 1000, due_amount: 1000, currency: "USD", issue_date: "2026-05-31", due_date: "2026-06-30", client: { id: 1, name: "Acme" } },
  { id: 2, number: "1000", state: "paid", amount: 500, due_amount: 0, currency: "USD", issue_date: "2026-05-01", due_date: "2026-05-31", client: { id: 1, name: "Acme" } },
  { id: 3, number: "999", state: "open", amount: 250, due_amount: 250, currency: "USD", issue_date: "2026-04-15", due_date: "2026-05-15", client: { id: 2, name: "Beta" } },
];

function listPage(items: unknown[], key = "invoices"): Response {
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

describe("invoices list", () => {
  it("rolls up by state with summed amount/due and complete:true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage(INVOICES));
    const out = await invoicesCommand([]);
    expect(out).toContain("total: 3");
    expect(out).toContain("draft: 1");
    expect(out).toContain("open: 1");
    expect(out).toContain("paid: 1");
    expect(out).toContain("amount: 1750");
    expect(out).toContain("due: 1250");
    expect(out).toContain("currency: USD");
    expect(out).toContain("complete: true");
    // Newest issue_date first.
    expect(out).toContain("invoices[3]{id,number,client,state,amount,due,issue_date,due_date}:");
    expect(out.indexOf("1001")).toBeLessThan(out.indexOf("1000"));
  });

  it("--drafts filters server-side via state=draft", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage([INVOICES[0]]));
    const out = await invoicesCommand(["--drafts"]);
    expect(out).toContain("scope: draft");
    expect(out).toContain("total: 1");
    expect(String(spy.mock.calls[0]?.[0])).toContain("state=draft");
  });

  it("rejects an unknown --state before any fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(invoicesCommand(["--state", "bogus"])).rejects.toThrow(/Unknown --state/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("notes mixed currencies instead of summing", async () => {
    const mixed = [
      { ...INVOICES[0], currency: "USD" },
      { ...INVOICES[1], currency: "EUR" },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage(mixed));
    const out = await invoicesCommand([]);
    expect(out).toContain("mixed currencies — not summed");
  });

  it("gives a definitive empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage([]));
    const out = await invoicesCommand(["--state", "closed"]);
    expect(out).toContain("0 invoices found");
  });

  it("announces a --limit cap loudly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage(INVOICES));
    const out = await invoicesCommand(["--limit", "1"]);
    expect(out).toContain("Showing 1 of 3 matched invoices");
  });

  it("translates a 403 into a FORBIDDEN error citing the manager role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    );
    await expect(invoicesCommand([])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves a client name then queries with client_id", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(listPage([{ id: 1, name: "Acme" }], "clients"))
      .mockResolvedValueOnce(listPage(INVOICES.filter((i) => i.client.id === 1)));
    const out = await invoicesCommand(["--client", "Acme"]);
    expect(out).toContain("client Acme");
    const listCall = spy.mock.calls.find(([url]) => String(url).includes("/invoices"));
    expect(String(listCall?.[0])).toContain("client_id=1");
  });
});

describe("invoices get", () => {
  const INVOICE = {
    id: 1, number: "1001", state: "draft", amount: 1000, due_amount: 1000, currency: "USD",
    subject: "May work", purchase_order: "PO-7", issue_date: "2026-05-31", due_date: "2026-06-30",
    payment_term: "net 30", period_start: "2026-05-01", period_end: "2026-05-31",
    tax: 5, tax_amount: 50, discount: null, discount_amount: null,
    sent_at: null, paid_at: null, paid_date: null, closed_at: null,
    client_key: "abc123", client: { id: 1, name: "Acme" }, creator: { id: 9, name: "Chris" },
    line_items: [{ id: 11, kind: "Service", description: "Dev", quantity: 10, unit_price: 100, amount: 1000, taxed: true, project: { id: 5, name: "Proj" } }],
  };

  function configWithBaseUri(): void {
    const dir = join(process.env.XDG_CONFIG_HOME!, "harvest-axi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ version: 1, token: "tok", account_id: "1", profile_cache: { user_id: 9, user_name: "Chris", account_name: "Acme", base_uri: "https://acme.harvestapp.com", cached_at: "x" } }),
    );
  }

  it("renders all field groups, line items, and composed public links", async () => {
    configWithBaseUri();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(INVOICE), { status: 200 }))
      .mockResolvedValueOnce(listPage([{ id: 7, paid_date: "2026-06-01", amount: 1000, recorded_by: "AP", notes: "wire" }], "invoice_payments"))
      .mockResolvedValueOnce(listPage([{ id: 8, sent_at: "2026-05-31T00:00:00Z", event_type: null, recipients: [{ email: "ap@acme.com" }], subject: "Invoice 1001" }], "invoice_messages"));
    const out = await invoicesCommand(["get", "1"]);
    expect(out).toContain("subject: May work");
    expect(out).toContain("payment_term: net 30");
    expect(out).toContain("tax_amount: 50");
    expect(out).toContain("web: \"https://acme.harvestapp.com/client/invoices/abc123\"");
    expect(out).toContain("pdf: \"https://acme.harvestapp.com/client/invoices/abc123.pdf\"");
    expect(out).toContain("line_items[1]{kind,description,project,quantity,unit_price,amount,taxed}:");
    expect(out).toContain("payments[1]{paid_date,amount,recorded_by,notes}:");
    expect(out).toContain("messages[1]{sent_at,event_type,recipients,subject}:");
    expect(out).toContain("ap@acme.com");
  });

  it("falls back to a client_key note when base_uri is uncached", async () => {
    // No config written → no profile_cache.base_uri.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(INVOICE), { status: 200 }))
      .mockResolvedValueOnce(listPage([], "invoice_payments"))
      .mockResolvedValueOnce(listPage([], "invoice_messages"));
    const out = await invoicesCommand(["get", "1"]);
    expect(out).toContain("client_key: abc123");
    expect(out).toContain("whoami --refresh");
  });

  it("--raw dumps the untranslated invoice without payment/message calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(INVOICE), { status: 200 }),
    );
    const out = await invoicesCommand(["get", "1", "--raw"]);
    expect(out).toContain("client_key: abc123");
    expect(spy).toHaveBeenCalledTimes(1); // no payments/messages fetch under --raw
  });

  it("requires an id", async () => {
    await expect(invoicesCommand(["get"])).rejects.toThrow(/requires an invoice id/);
  });
});
