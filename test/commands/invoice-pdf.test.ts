/**
 * specs/commands/invoices.md — `invoices pdf <id>`.
 */
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoicesCommand } from "../../src/commands/invoices.js";
import { writeConfig, readConfig } from "../../src/config.js";

const INVOICE = {
  id: 1,
  number: "INV/2026-01",
  client_key: "abc123",
  amount: 1000,
  client: { id: 1, name: "AcmeCo" },
};

const PDF = Buffer.from("%PDF-1.4\nfake pdf body\n%%EOF\n");

function invoiceResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ...INVOICE, ...overrides }), { status: 200 });
}

/** Cache a base_uri the way `auth whoami --refresh` would. */
function cacheBaseUri(base = "https://acme.harvestapp.com") {
  writeConfig({
    ...readConfig(),
    profile_cache: { base_uri: base } as never,
  });
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

/** Serve the invoice JSON, then the PDF bytes. */
function mockFetch(pdf: Buffer | Response = PDF, invoice = invoiceResponse()) {
  let call = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    call += 1;
    if (call === 1) return Promise.resolve(invoice.clone());
    return Promise.resolve(pdf instanceof Response ? pdf : new Response(pdf, { status: 200 }));
  });
}

function wrotePath(out: string): string {
  const m = /wrote: "?(\S+?)"? \(/.exec(out);
  if (!m) throw new Error(`no wrote: line in\n${out}`);
  return m[1];
}

describe("invoices pdf", () => {
  it("writes the PDF to an auto path at 0600 and confirms the invoice", async () => {
    cacheBaseUri();
    mockFetch();
    const out = await invoicesCommand(["pdf", "1"]);
    const path = wrotePath(out);
    expect(path.startsWith(join(tmpdir(), "harvest-axi"))).toBe(true);
    // The client_key URL is an unauthenticated bearer secret, so the artifact
    // is sensitive even though fetching it needed no token.
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path)).toEqual(PDF);
    // Confirmable without opening the file or a follow-up `get`.
    expect(out).toContain("bytes");
    expect(out).toContain("AcmeCo");
    expect(out).toContain("1000");
  });

  it("sanitizes the invoice number into the filename", async () => {
    cacheBaseUri();
    mockFetch();
    const out = await invoicesCommand(["pdf", "1"]);
    // "INV/2026-01" must not create a directory.
    expect(wrotePath(out)).toContain("invoice-INV-2026-01-1.pdf");
  });

  it("honours --out=<path> with the default umask", async () => {
    cacheBaseUri();
    mockFetch();
    const target = join(mkdtempSync(join(tmpdir(), "pdf-")), "inv.pdf");
    const out = await invoicesCommand(["pdf", "1", `--out=${target}`]);
    expect(out).toContain(target);
    expect(readFileSync(target)).toEqual(PDF);
    expect(statSync(target).mode & 0o777).not.toBe(0o600);
  });

  it("fetches the public URL without credentials", async () => {
    cacheBaseUri();
    const spy = mockFetch();
    await invoicesCommand(["pdf", "1"]);
    const [url, init] = spy.mock.calls[1] ?? [];
    expect(String(url)).toBe("https://acme.harvestapp.com/client/invoices/abc123.pdf");
    // Credentials must not leak to a public endpoint that doesn't need them.
    const headers = new Headers((init as RequestInit | undefined)?.headers ?? {});
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("harvest-account-id")).toBeNull();
  });

  it("names the = form when the space form is used", async () => {
    await expect(invoicesCommand(["pdf", "1", "--out", "/tmp/x.pdf"])).rejects.toThrow(
      /attached with/,
    );
  });

  it("fails on an uncached base_uri, before fetching the PDF", async () => {
    const spy = mockFetch();
    await expect(invoicesCommand(["pdf", "1"])).rejects.toThrow(/account URL is not cached/);
    // Only the invoice read happened — no guessed host was contacted.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fails distinctly when the invoice has no client_key", async () => {
    cacheBaseUri();
    mockFetch(PDF, invoiceResponse({ client_key: undefined }));
    await expect(invoicesCommand(["pdf", "1"])).rejects.toThrow(/no public link/);
  });

  it("translates a non-2xx from the public URL", async () => {
    cacheBaseUri();
    mockFetch(new Response("nope", { status: 404 }));
    await expect(invoicesCommand(["pdf", "1"])).rejects.toThrow(/HTTP 404/);
  });

  it("rejects an HTML error page served with a 200", async () => {
    cacheBaseUri();
    // A stale key can yield HTML with a 200, so trust the bytes not the status.
    mockFetch(new Response("<html>gone</html>", { status: 200 }));
    await expect(invoicesCommand(["pdf", "1"])).rejects.toThrow(/did not return a PDF/);
  });

  it("requires an id and rejects unknown flags before any call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(invoicesCommand(["pdf"])).rejects.toThrow(/requires a numeric invoice id/);
    await expect(invoicesCommand(["pdf", "1", "--bogus"])).rejects.toThrow(/Unknown flag --bogus/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("invoices get discoverability", () => {
  it("suggests the download when links resolved", async () => {
    cacheBaseUri();
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(invoiceResponse());
      return Promise.resolve(
        new Response(
          JSON.stringify({
            invoice_payments: [],
            invoice_messages: [],
            page: 1,
            total_pages: 1,
            total_entries: 0,
            links: { next: null },
          }),
          { status: 200 },
        ),
      );
    });
    const out = await invoicesCommand(["get", "1"]);
    expect(out).toContain("harvest-axi invoices pdf 1");
  });

  it("omits the suggestion when links could not be composed", async () => {
    // A hint pointing at a command that will fail is worse than none.
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(invoiceResponse());
      return Promise.resolve(
        new Response(
          JSON.stringify({
            invoice_payments: [],
            invoice_messages: [],
            page: 1,
            total_pages: 1,
            total_entries: 0,
            links: { next: null },
          }),
          { status: 200 },
        ),
      );
    });
    const out = await invoicesCommand(["get", "1"]);
    expect(out).not.toContain("invoices pdf");
    expect(out).toContain("whoami --refresh");
  });
});
