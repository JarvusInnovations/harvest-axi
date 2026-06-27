import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimatesCommand } from "../../src/commands/estimates.js";

const ESTIMATES = [
  {
    id: 1,
    number: "E-1001",
    state: "draft",
    amount: 1000,
    currency: "USD",
    issue_date: "2026-05-31",
    client: { id: 1, name: "Acme" },
  },
  {
    id: 2,
    number: "E-1000",
    state: "accepted",
    amount: 500,
    currency: "USD",
    issue_date: "2026-05-01",
    client: { id: 1, name: "Acme" },
  },
  {
    id: 3,
    number: "E-999",
    state: "sent",
    amount: 250,
    currency: "USD",
    issue_date: "2026-04-15",
    client: { id: 2, name: "Beta" },
  },
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
    id: 1,
    number: "E-1001",
    state: "draft",
    amount: 1000,
    currency: "USD",
    subject: "Phase 1",
    purchase_order: "PO-7",
    issue_date: "2026-05-31",
    tax: 5,
    tax_amount: 50,
    tax2: null,
    tax2_amount: null,
    discount: null,
    discount_amount: null,
    sent_at: null,
    accepted_at: null,
    declined_at: null,
    client_key: "abc123",
    client: { id: 1, name: "Acme" },
    creator: { id: 9, name: "Chris" },
    line_items: [
      {
        id: 11,
        kind: "Service",
        description: "Scoping",
        quantity: 10,
        unit_price: 100,
        amount: 1000,
        taxed: true,
      },
    ],
  };

  function configWithBaseUri(): void {
    const dir = join(process.env.XDG_CONFIG_HOME!, "harvest-axi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        token: "tok",
        account_id: "1",
        profile_cache: {
          user_id: 9,
          user_name: "Chris",
          account_name: "Acme",
          base_uri: "https://acme.harvestapp.com",
          cached_at: "x",
        },
      }),
    );
  }

  it("renders all field groups, line items, messages, and composed public links", async () => {
    configWithBaseUri();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(ESTIMATE), { status: 200 }))
      .mockResolvedValueOnce(
        listPage(
          [
            {
              id: 8,
              sent_at: "2026-05-31T00:00:00Z",
              event_type: null,
              recipients: [{ email: "ap@acme.com" }],
              subject: "Estimate E-1001",
            },
          ],
          "estimate_messages",
        ),
      );
    const out = await estimatesCommand(["get", "1"]);
    expect(out).toContain("subject: Phase 1");
    expect(out).toContain("tax_amount: 50");
    expect(out).toContain("accepted_at: —");
    expect(out).toContain('web: "https://acme.harvestapp.com/client/estimates/abc123"');
    expect(out).toContain('pdf: "https://acme.harvestapp.com/client/estimates/abc123.pdf"');
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
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(ESTIMATE), { status: 200 }));
    const out = await estimatesCommand(["get", "1", "--raw"]);
    expect(out).toContain("client_key: abc123");
    expect(spy).toHaveBeenCalledTimes(1); // no messages fetch under --raw
  });

  it("requires an id", async () => {
    await expect(estimatesCommand(["get"])).rejects.toThrow(/requires a numeric estimate id/);
  });
});

describe("estimates create", () => {
  it("requires --client before any fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(estimatesCommand(["create"])).rejects.toThrow(/requires --client/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("creates a free-form draft, resolving the client and parsing lines", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(listPage([{ id: 1, name: "Acme" }], "clients")) // resolve client
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 99,
            number: "1",
            state: "draft",
            amount: 2000,
            client: { id: 1, name: "Acme" },
            line_items: [{}],
          }),
          { status: 201 },
        ),
      );
    const out = await estimatesCommand([
      "create",
      "--client",
      "Acme",
      "--line",
      "Service|200|10|Phase 1 scope",
    ]);
    expect(out).toContain("draft created");
    const postCall = spy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.client_id).toBe(1);
    expect(body.line_items).toEqual([
      { kind: "Service", unit_price: 200, quantity: 10, description: "Phase 1 scope" },
    ]);
    expect(String(postCall?.[0])).toContain("/estimates");
  });

  it("requires --line items", async () => {
    // Numeric client id short-circuits resolution, so no fetch precedes the throw.
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(estimatesCommand(["create", "--client", "1"])).rejects.toThrow(/needs --line/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a --line with a trailing project segment (over-segmented)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      listPage([{ id: 1, name: "Acme" }], "clients"),
    );
    await expect(
      estimatesCommand(["create", "--client", "Acme", "--line", "Service|200|10|Phase 1|GTFS"]),
    ).rejects.toThrow(/too many .* segments/);
  });
});

describe("estimates edit/delete — draft guard", () => {
  const draft = {
    id: 5,
    state: "draft",
    number: "1",
    amount: 0,
    client: { id: 1, name: "Acme" },
    line_items: [],
  };
  const accepted = {
    id: 6,
    state: "accepted",
    number: "2",
    amount: 100,
    client: { id: 1, name: "Acme" },
    line_items: [],
  };

  it("edits a draft: guards via GET, then PATCHes with line ops", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 })) // guard GET
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...draft, line_items: [{}] }), { status: 200 }),
      ); // PATCH
    const out = await estimatesCommand([
      "edit",
      "5",
      "--notes",
      "hi",
      "--line",
      "Service|10|1|x",
      "--remove-line",
      "777",
    ]);
    expect(out).toContain("draft updated");
    const patch = spy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
    const body = JSON.parse((patch![1] as RequestInit).body as string);
    expect(body.notes).toBe("hi");
    expect(body.line_items).toEqual([
      { kind: "Service", unit_price: 10, quantity: 1, description: "x" },
      { id: 777, _destroy: true },
    ]);
    // No payment_options re-send — estimates have no such field.
    expect("payment_options" in body).toBe(false);
  });

  it("updates an existing line via --update-line, blank segments left unchanged", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 })) // guard GET
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...draft, line_items: [{ id: 777 }] }), { status: 200 }),
      ); // PATCH
    await estimatesCommand(["edit", "5", "--update-line", "777|Service|220||revised rate"]);
    const patch = spy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
    const body = JSON.parse((patch![1] as RequestInit).body as string);
    expect(body.line_items).toEqual([
      { id: 777, kind: "Service", unit_price: 220, description: "revised rate" },
    ]);
  });

  it("requires at least one field or line change", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 }));
    await expect(estimatesCommand(["edit", "5"])).rejects.toThrow(
      /at least one field or line change/,
    );
    expect(spy.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(
      false,
    );
  });

  it("refuses to edit a non-draft and never PATCHes", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(accepted), { status: 200 }));
    await expect(estimatesCommand(["edit", "6", "--notes", "x"])).rejects.toThrow(/not a draft/);
    expect(spy.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(
      false,
    );
  });

  it("refuses to delete a non-draft and never DELETEs", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(accepted), { status: 200 }));
    await expect(estimatesCommand(["delete", "6"])).rejects.toThrow(/not a draft/);
    expect(spy.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE")).toBe(
      false,
    );
  });

  it("deletes a draft after the guard passes", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 })) // guard
      .mockResolvedValueOnce(new Response("", { status: 200 })); // DELETE
    const out = await estimatesCommand(["delete", "5"]);
    expect(out).toContain("draft deleted");
    expect(spy.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE")).toBe(
      true,
    );
  });

  it("delete of an absent estimate is an idempotent no-op", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    );
    const out = await estimatesCommand(["delete", "404"]);
    expect(out).toContain("no-op");
  });
});

describe("write boundary — out-of-scope endpoints are never mutated", () => {
  // The draft-workbench boundary: harvest-axi must never send, mark-as-sent,
  // accept, decline, or re-open. `get` legitimately *reads* /messages (GET via
  // paginateAll), so we assert the absence of the mutating signals.
  const src = readFileSync(new URL("../../src/commands/estimates.ts", import.meta.url), "utf-8");

  it("never sets a transition event_type in a request body", () => {
    expect(src).not.toMatch(/event_type:\s*["'`]/);
  });

  it("only ever touches /messages through GET paginateAll", () => {
    const refs = [...src.matchAll(/[\\`"][^\\`"]*\/messages\b/g)];
    expect(refs.length).toBeGreaterThan(0); // a read does exist
    for (const m of refs) {
      // Wide enough to span a line-wrapped `paginateAll<...>(` call header.
      const line = src.slice(Math.max(0, m.index! - 120), m.index! + 40);
      expect(line).toContain("paginateAll");
    }
  });

  it("never references a payments sub-resource (estimates aren't paid)", () => {
    expect(src).not.toMatch(/\/payments\b/);
  });
});
