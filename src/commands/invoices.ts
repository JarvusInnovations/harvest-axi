import { AxiError } from "axi-sdk-js";
import { readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity } from "../harvest/resolve.js";
import type { QueryValue } from "../harvest/client.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";
import { parseRange, type RangeFlags, NAMED_WINDOWS } from "../time/ranges.js";

export const INVOICES_HELP = `usage: harvest-axi invoices [get <id>] [flags]
reads (Admin/Manager only — a non-manager token gets FORBIDDEN):
  (none)                   list/review invoices (totals + by-state header)
  get <id>                 full detail: money, lifecycle, links, line items,
                           payments, messages
list filters:
  --state <s>              draft | open | paid | closed
  --drafts                 shortcut for --state draft
  --client <id|name>       one client   --project <id|name>  one project
  --from <date> --to <date>             issue_date window
  --since <dur>            7d | 2w | 1m  (maps to updated_since)
  --this-month --last-month --this-week --last-week --today --yesterday
  --limit <n>              cap raw rows (default 200)
get flags:
  --raw                    dump untranslated invoice JSON
examples:
  harvest-axi invoices --drafts
  harvest-axi invoices --client "Caltrans" --state open
  harvest-axi invoices --last-month
  harvest-axi invoices get 13150403
`;

const STATES = ["draft", "open", "paid", "closed"] as const;
type State = (typeof STATES)[number];

interface ListFlags {
  range: RangeFlags;
  state?: State;
  client?: string;
  project?: string;
  limit: number;
}

function parseListFlags(args: string[]): ListFlags {
  const flags: ListFlags = { range: {}, limit: 200 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--from": flags.range.from = next; i++; break;
      case "--to": flags.range.to = next; i++; break;
      case "--since": flags.range.since = next; i++; break;
      case "--client": flags.client = next; i++; break;
      case "--project": flags.project = next; i++; break;
      case "--drafts": flags.state = "draft"; break;
      case "--limit": flags.limit = Math.max(1, parseInt(next, 10) || 200); i++; break;
      case "--state": {
        if (!STATES.includes(next as State)) {
          throw new AxiError(`Unknown --state "${next}"`, "VALIDATION_ERROR", [
            `Valid states: ${STATES.join(", ")}`,
          ]);
        }
        flags.state = next as State;
        i++;
        break;
      }
      default:
        if (arg.startsWith("--") && (NAMED_WINDOWS as readonly string[]).includes(arg.slice(2))) {
          flags.range.named = arg.slice(2);
        }
        break;
    }
  }
  return flags;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

/** Round money to 2 decimals as a number so TOON renders it bare (no quotes). */
function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

const nestedName = (entry: Record<string, unknown>, key: string): string =>
  ((entry[key] as { name?: string } | undefined)?.name ?? "—");

export async function invoicesCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return INVOICES_HELP;

  if (args[0] === "get") {
    const id = args[1];
    if (!id || id.startsWith("--")) {
      throw new AxiError("invoices get requires an invoice id", "VALIDATION_ERROR", [
        "Run `harvest-axi invoices` to list invoices and their ids",
      ]);
    }
    return invoiceDetail(id, args.slice(2));
  }

  return invoiceList(args);
}

async function invoiceList(args: string[]): Promise<string> {
  const flags = parseListFlags(args);
  // issue_date window; --since maps to updated_since. No window flag → no date filter.
  const range =
    flags.range.from || flags.range.to || flags.range.named || flags.range.since
      ? parseRange(flags.range)
      : undefined;

  const query: Record<string, QueryValue> = {};
  const scopeParts: string[] = [];

  // Resolve names → ids before any fetch (fail fast).
  if (flags.client) {
    const c = await resolveEntity("client", flags.client);
    query.client_id = c.id;
    scopeParts.push(`client ${c.name}`);
  }
  if (flags.project) {
    const p = await resolveEntity("project", flags.project);
    query.project_id = p.id;
    scopeParts.push(`project ${p.name}`);
  }
  if (flags.state) {
    query.state = flags.state;
    scopeParts.push(flags.state);
  }
  if (range) {
    if (flags.range.since) {
      query.updated_since = `${range.from}T00:00:00Z`;
    } else {
      query.from = range.from;
      query.to = range.to;
    }
  }

  const result = await paginateAll<Record<string, unknown>>("invoices", "invoices", query);
  const invoices = result.items;

  // Totals + by-state rollup — the answer before any row.
  const byState: Record<string, number> = { draft: 0, open: 0, paid: 0, closed: 0 };
  let amount = 0;
  let due = 0;
  const currencies = new Set<string>();
  for (const inv of invoices) {
    const st = String(inv.state ?? "—");
    byState[st] = (byState[st] ?? 0) + 1;
    amount += num(inv.amount);
    due += num(inv.due_amount);
    if (typeof inv.currency === "string") currencies.add(inv.currency);
  }
  const mixed = currencies.size > 1;

  const header: Record<string, unknown> = {
    range: range ? range.label : "all dates",
    scope: scopeParts.length ? scopeParts.join(" · ") : "all invoices",
    total: invoices.length,
    draft: byState.draft,
    open: byState.open,
    paid: byState.paid,
    closed: byState.closed,
    complete: result.complete,
  };
  if (mixed) {
    header.amount = "(mixed currencies — not summed)";
    header.due = "(mixed currencies — not summed)";
  } else {
    header.amount = money2(amount);
    header.due = money2(due);
    header.currency = currencies.size === 1 ? [...currencies][0] : "—";
  }
  if (!result.complete) header.capped_at_pages = result.pages_fetched;

  if (invoices.length === 0) {
    return joinBlocks(
      renderObject(header),
      renderObject({
        invoices: `0 invoices found${scopeParts.length ? ` for ${scopeParts.join(" · ")}` : ""}${range ? ` in ${range.label}` : ""}`,
      }),
      renderHelp([
        flags.state || flags.client || flags.project
          ? "Drop the --state/--client/--project filters to widen the search"
          : "Broaden with a --from/--to or --last-month window",
      ]),
    );
  }

  // Newest issued first (Harvest's default order; re-assert after local handling).
  const sorted = [...invoices].sort((a, b) =>
    String(b.issue_date ?? "").localeCompare(String(a.issue_date ?? "")),
  );
  const capped = sorted.length > flags.limit;
  const shown = capped ? sorted.slice(0, flags.limit) : sorted;

  const suggestions: string[] = ["Run `harvest-axi invoices get <id>` for one invoice's full detail"];
  if (capped) {
    suggestions.unshift(
      `Showing ${flags.limit} of ${sorted.length} matched invoices — raise --limit or narrow the filters`,
    );
  }
  if (!flags.state) suggestions.push("Run `harvest-axi invoices --drafts` to review draft invoices");

  return joinBlocks(
    renderObject(header),
    renderList("invoices", shown, [
      { name: "id", extract: (i) => i.id },
      { name: "number", extract: (i) => i.number ?? "—" },
      { name: "client", extract: (i) => nestedName(i, "client") },
      { name: "state", extract: (i) => i.state },
      { name: "amount", extract: (i) => money2(num(i.amount)) },
      { name: "due", extract: (i) => money2(num(i.due_amount)) },
      { name: "issue_date", extract: (i) => i.issue_date ?? "—" },
      { name: "due_date", extract: (i) => i.due_date ?? "—" },
    ]),
    renderHelp(suggestions),
  );
}

async function invoiceDetail(id: string, rest: string[]): Promise<string> {
  const raw = rest.includes("--raw");
  const invoice = await harvestRequest<Record<string, unknown>>(`invoices/${id}`);

  if (raw) return renderObject({ invoice });

  const payments = await paginateAll<Record<string, unknown>>(`invoices/${id}/payments`, "invoice_payments");
  const messages = await paginateAll<Record<string, unknown>>(`invoices/${id}/messages`, "invoice_messages");

  const lineItems = (invoice.line_items as Record<string, unknown>[]) ?? [];

  const header = {
    id: invoice.id,
    number: invoice.number ?? "—",
    state: invoice.state ?? "—",
    client: nestedName(invoice, "client"),
    subject: invoice.subject ?? "—",
    purchase_order: invoice.purchase_order ?? "—",
    creator: nestedName(invoice, "creator"),
    issue_date: invoice.issue_date ?? "—",
    due_date: invoice.due_date ?? "—",
    payment_term: invoice.payment_term ?? "—",
    period_start: invoice.period_start ?? "—",
    period_end: invoice.period_end ?? "—",
    payment_options: Array.isArray(invoice.payment_options)
      ? (invoice.payment_options as string[]).join(", ") || "—"
      : "—",
    created_at: invoice.created_at ?? "—",
    updated_at: invoice.updated_at ?? "—",
  };

  const moneyBlock = {
    amount: money2(num(invoice.amount)),
    due_amount: money2(num(invoice.due_amount)),
    currency: invoice.currency ?? "—",
    tax: invoice.tax ?? "—",
    tax_amount: invoice.tax_amount == null ? "—" : money2(num(invoice.tax_amount)),
    tax2: invoice.tax2 ?? "—",
    tax2_amount: invoice.tax2_amount == null ? "—" : money2(num(invoice.tax2_amount)),
    discount: invoice.discount ?? "—",
    discount_amount: invoice.discount_amount == null ? "—" : money2(num(invoice.discount_amount)),
  };

  const lifecycle = {
    sent_at: invoice.sent_at ?? "—",
    paid_at: invoice.paid_at ?? "—",
    paid_date: invoice.paid_date ?? "—",
    closed_at: invoice.closed_at ?? "—",
  };

  const blocks: string[] = [
    renderObject({ invoice: header }),
    renderObject({ money: moneyBlock }),
    renderObject({ lifecycle }),
  ];

  // Public links from client_key + the account's base_uri (cached at auth setup).
  const clientKey = invoice.client_key as string | undefined;
  const baseUri = readConfig().profile_cache?.base_uri;
  if (clientKey && baseUri) {
    const url = `${baseUri.replace(/\/$/, "")}/client/invoices/${clientKey}`;
    blocks.push(renderObject({ links: { web: url, pdf: `${url}.pdf` } }));
  } else if (clientKey) {
    blocks.push(renderObject({ links: { client_key: clientKey, note: "run `harvest-axi auth whoami --refresh` to cache the account URL for full links" } }));
  }

  // References — only the present ones.
  const refs: Record<string, unknown> = {};
  if (invoice.estimate) refs.estimate = (invoice.estimate as { id?: number }).id ?? invoice.estimate;
  if (invoice.retainer) refs.retainer = (invoice.retainer as { id?: number }).id ?? invoice.retainer;
  if (invoice.recurring_invoice_id) refs.recurring_invoice_id = invoice.recurring_invoice_id;
  if (Object.keys(refs).length > 0) blocks.push(renderObject({ references: refs }));

  blocks.push(
    renderList("line_items", lineItems, [
      { name: "kind", extract: (i) => i.kind ?? "—" },
      { name: "description", extract: (i) => i.description ?? "—" },
      { name: "project", extract: (i) => nestedName(i, "project") },
      { name: "quantity", extract: (i) => i.quantity ?? "—" },
      { name: "unit_price", extract: (i) => i.unit_price ?? "—" },
      { name: "amount", extract: (i) => money2(num(i.amount)) },
      { name: "taxed", extract: (i) => i.taxed },
    ]),
  );

  if (payments.items.length > 0) {
    blocks.push(
      renderList("payments", payments.items, [
        { name: "paid_date", extract: (i) => i.paid_date ?? i.paid_at ?? "—" },
        { name: "amount", extract: (i) => money2(num(i.amount)) },
        { name: "recorded_by", extract: (i) => i.recorded_by ?? "—" },
        { name: "notes", extract: (i) => i.notes ?? "—" },
      ]),
    );
  }

  if (messages.items.length > 0) {
    blocks.push(
      renderList("messages", messages.items, [
        { name: "sent_at", extract: (i) => i.sent_at ?? "—" },
        { name: "event_type", extract: (i) => i.event_type ?? "(email)" },
        {
          name: "recipients",
          extract: (i) =>
            Array.isArray(i.recipients)
              ? (i.recipients as Array<{ email?: string }>).map((r) => r.email).filter(Boolean).join(", ") || "—"
              : "—",
        },
        { name: "subject", extract: (i) => i.subject ?? "—" },
      ]),
    );
  }

  return joinBlocks(...blocks);
}
