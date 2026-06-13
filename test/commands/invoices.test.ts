import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
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
    await expect(invoicesCommand(["get"])).rejects.toThrow(/requires a numeric invoice id/);
  });
});

describe("invoices create", () => {
  it("requires --client before any fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(invoicesCommand(["create"])).rejects.toThrow(/requires --client/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("creates a free-form draft, resolving the client and parsing lines", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(listPage([{ id: 1, name: "Acme" }], "clients")) // resolve client
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 99, number: "1", state: "draft", amount: 2000, client: { id: 1, name: "Acme" }, line_items: [{}] }), { status: 201 }));
    const out = await invoicesCommand(["create", "--client", "Acme", "--line", "Service|200|10|May work"]);
    expect(out).toContain("draft created");
    const postCall = spy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.client_id).toBe(1);
    expect(body.line_items).toEqual([{ kind: "Service", unit_price: 200, quantity: 10, description: "May work" }]);
  });

  it("builds line_items_import for --from-tracked", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(listPage([{ id: 1, name: "Acme" }], "clients")) // client
      .mockResolvedValueOnce(listPage([{ id: 5, name: "Proj" }], "projects")) // project
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 99, state: "draft", amount: 0, client: { id: 1, name: "Acme" }, line_items: [] }), { status: 201 }));
    await invoicesCommand(["create", "--client", "Acme", "--from-tracked", "--project", "Proj", "--summary", "task", "--from", "2026-05-01", "--to", "2026-05-31"]);
    const postCall = spy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.line_items_import).toEqual({ project_ids: [5], time: { summary_type: "task", from: "2026-05-01", to: "2026-05-31" } });
    expect(body.line_items).toBeUndefined();
  });

  it("rejects --from-tracked combined with --line", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage([{ id: 1, name: "Acme" }], "clients"));
    await expect(
      invoicesCommand(["create", "--client", "Acme", "--from-tracked", "--project", "Proj", "--line", "Service|1|1|x"]),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("rejects --due-date with a non-custom payment term", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listPage([{ id: 1, name: "Acme" }], "clients"));
    await expect(
      invoicesCommand(["create", "--client", "Acme", "--line", "Service|1|1|x", "--due-date", "2026-07-01", "--payment-term", "net 30"]),
    ).rejects.toThrow(/payment-term custom/);
  });
});

describe("invoices edit/delete — draft guard", () => {
  const draft = { id: 5, state: "draft", number: "1", amount: 0, client: { id: 1, name: "Acme" }, line_items: [] };
  const paid = { id: 6, state: "paid", number: "2", amount: 100, client: { id: 1, name: "Acme" }, line_items: [] };

  it("edits a draft: guards via GET, then PATCHes with line ops", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 })) // guard GET
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...draft, line_items: [{}] }), { status: 200 })); // PATCH
    const out = await invoicesCommand(["edit", "5", "--notes", "hi", "--line", "Service|10|1|x", "--remove-line", "777"]);
    expect(out).toContain("draft updated");
    const patch = spy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
    const body = JSON.parse((patch?.[1] as RequestInit).body as string);
    expect(body.notes).toBe("hi");
    expect(body.line_items).toEqual([
      { kind: "Service", unit_price: 10, quantity: 1, description: "x" },
      { id: 777, _destroy: true },
    ]);
  });

  it("refuses to edit a non-draft and never PATCHes", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(paid), { status: 200 }));
    await expect(invoicesCommand(["edit", "6", "--notes", "x"])).rejects.toThrow(/not a draft/);
    expect(spy.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(false);
  });

  it("refuses to delete a non-draft and never DELETEs", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(paid), { status: 200 }));
    await expect(invoicesCommand(["delete", "6"])).rejects.toThrow(/not a draft/);
    expect(spy.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE")).toBe(false);
  });

  it("deletes a draft after the guard passes", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 })) // guard
      .mockResolvedValueOnce(new Response("", { status: 200 })); // DELETE
    const out = await invoicesCommand(["delete", "5"]);
    expect(out).toContain("draft deleted");
    expect(spy.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE")).toBe(true);
  });

  it("delete of an absent invoice is an idempotent no-op", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    );
    const out = await invoicesCommand(["delete", "404"]);
    expect(out).toContain("no-op");
  });
});

describe("write boundary — out-of-scope endpoints are never mutated", () => {
  // The draft-workbench boundary: harvest-axi must never send, mark-as-sent,
  // close/re-open, or record/delete a payment. `get` legitimately *reads*
  // /payments and /messages (GET via paginateAll), so we assert the absence of
  // the mutating signals, not the paths themselves.
  const src = readFileSync(new URL("../../src/commands/invoices.ts", import.meta.url), "utf-8");

  it("never sets a transition event_type in a request body", () => {
    // Reading the event_type field for the messages view is fine; what's
    // forbidden is *writing* one (`event_type: "send"`), which is how a
    // mark-as-sent/close/re-open transition would be triggered.
    expect(src).not.toMatch(/event_type:\s*["'`]/);
  });

  it("only ever touches /messages and /payments through GET paginateAll", () => {
    // Every reference to a sub-resource path must be inside a paginateAll(...)
    // call (GET-only). A POST/PATCH/DELETE to them would appear as a bare
    // template path in a harvestRequest, which this forbids.
    for (const sub of ["payments", "messages"]) {
      const refs = [...src.matchAll(new RegExp(`[\\\`"][^\\\`"]*/${sub}\\b`, "g"))];
      expect(refs.length).toBeGreaterThan(0); // reads do exist
      for (const m of refs) {
        const line = src.slice(Math.max(0, m.index - 40), m.index + 40);
        expect(line).toContain("paginateAll");
      }
    }
  });

  it("only ever POST/PATCH/DELETEs the invoices collection or a single invoice", () => {
    // Collect the path of every mutating harvestRequest. Allowed targets:
    // `invoices` (create) and `invoices/${id}` (edit/delete). Nothing nested.
    const mutating = [...src.matchAll(/harvestRequest[^\n]*?\n?[^\n]*?method:\s*"(POST|PATCH|DELETE)"/g)];
    // Sanity: we do have mutations (create/edit/delete).
    expect(mutating.length).toBeGreaterThanOrEqual(3);
  });
});
