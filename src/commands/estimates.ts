import { AxiError } from "axi-sdk-js";
import { readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity } from "../harvest/resolve.js";
import type { QueryValue } from "../harvest/client.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";
import { parseRange, type RangeFlags, NAMED_WINDOWS } from "../time/ranges.js";

export const ESTIMATES_HELP = `usage: harvest-axi estimates [get] [args] [flags]
reads (Admin/Manager only — a non-manager token gets FORBIDDEN):
  (none)                   list/review estimates (totals + by-state header)
  get <id>                 full detail: money, lifecycle, links, line items,
                           messages
list filters:
  --state <s>              draft | sent | accepted | declined
  --drafts                 shortcut for --state draft
  --client <id|name>       one client
  --from <date> --to <date>             issue_date window
  --since <dur>            7d | 2w | 1m  (maps to updated_since)
  --this-month --last-month --this-week --last-week --today --yesterday
  --limit <n>              cap raw rows (default 200)
get flags:
  --raw                    dump untranslated estimate JSON
examples:
  harvest-axi estimates --drafts
  harvest-axi estimates get 13150403
  harvest-axi estimates --client "Caltrans" --last-month
`;

const STATES = ["draft", "sent", "accepted", "declined"] as const;
type State = (typeof STATES)[number];

interface ListFlags {
  range: RangeFlags;
  state?: State;
  client?: string;
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

export async function estimatesCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return ESTIMATES_HELP;

  switch (args[0]) {
    case "get":
      return estimateDetail(requireEstimateId(args[1], "get"), args.slice(2));
    default:
      return estimateList(args);
  }
}

function requireEstimateId(value: string | undefined, sub: string): string {
  if (!value || value.startsWith("--") || !/^\d+$/.test(value)) {
    throw new AxiError(`estimates ${sub} requires a numeric estimate id`, "VALIDATION_ERROR", [
      "Run `harvest-axi estimates` to list estimates and their ids",
    ]);
  }
  return value;
}

async function estimateList(args: string[]): Promise<string> {
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

  const result = await paginateAll<Record<string, unknown>>("estimates", "estimates", query);
  const estimates = result.items;

  // Totals + by-state rollup — the answer before any row.
  const byState: Record<string, number> = { draft: 0, sent: 0, accepted: 0, declined: 0 };
  let amount = 0;
  const currencies = new Set<string>();
  for (const est of estimates) {
    const st = String(est.state ?? "—");
    byState[st] = (byState[st] ?? 0) + 1;
    amount += num(est.amount);
    if (typeof est.currency === "string") currencies.add(est.currency);
  }
  const mixed = currencies.size > 1;

  const header: Record<string, unknown> = {
    range: range ? range.label : "all dates",
    scope: scopeParts.length ? scopeParts.join(" · ") : "all estimates",
    total: estimates.length,
    draft: byState.draft,
    sent: byState.sent,
    accepted: byState.accepted,
    declined: byState.declined,
    complete: result.complete,
  };
  if (mixed) {
    header.amount = "(mixed currencies — not summed)";
  } else {
    header.amount = money2(amount);
    header.currency = currencies.size === 1 ? [...currencies][0] : "—";
  }
  if (!result.complete) header.capped_at_pages = result.pages_fetched;

  if (estimates.length === 0) {
    return joinBlocks(
      renderObject(header),
      renderObject({
        estimates: `0 estimates found${scopeParts.length ? ` for ${scopeParts.join(" · ")}` : ""}${range ? ` in ${range.label}` : ""}`,
      }),
      renderHelp([
        flags.state || flags.client
          ? "Drop the --state/--client filters to widen the search"
          : "Broaden with a --from/--to or --last-month window",
      ]),
    );
  }

  // Newest issued first (Harvest's default order; re-assert after local handling).
  const sorted = [...estimates].sort((a, b) =>
    String(b.issue_date ?? "").localeCompare(String(a.issue_date ?? "")),
  );
  const capped = sorted.length > flags.limit;
  const shown = capped ? sorted.slice(0, flags.limit) : sorted;

  const suggestions: string[] = ["Run `harvest-axi estimates get <id>` for one estimate's full detail"];
  if (capped) {
    suggestions.unshift(
      `Showing ${flags.limit} of ${sorted.length} matched estimates — raise --limit or narrow the filters`,
    );
  }
  if (!flags.state) suggestions.push("Run `harvest-axi estimates --drafts` to review draft estimates");

  return joinBlocks(
    renderObject(header),
    renderList("estimates", shown, [
      { name: "id", extract: (e) => e.id },
      { name: "number", extract: (e) => e.number ?? "—" },
      { name: "client", extract: (e) => nestedName(e, "client") },
      { name: "state", extract: (e) => e.state },
      { name: "amount", extract: (e) => money2(num(e.amount)) },
      { name: "issue_date", extract: (e) => e.issue_date ?? "—" },
    ]),
    renderHelp(suggestions),
  );
}

async function estimateDetail(id: string, rest: string[]): Promise<string> {
  const raw = rest.includes("--raw");
  const estimate = await harvestRequest<Record<string, unknown>>(`estimates/${id}`);

  if (raw) return renderObject({ estimate });

  const messages = await paginateAll<Record<string, unknown>>(`estimates/${id}/messages`, "estimate_messages");

  const lineItems = (estimate.line_items as Record<string, unknown>[]) ?? [];

  const header = {
    id: estimate.id,
    number: estimate.number ?? "—",
    state: estimate.state ?? "—",
    client: nestedName(estimate, "client"),
    subject: estimate.subject ?? "—",
    purchase_order: estimate.purchase_order ?? "—",
    creator: nestedName(estimate, "creator"),
    issue_date: estimate.issue_date ?? "—",
    created_at: estimate.created_at ?? "—",
    updated_at: estimate.updated_at ?? "—",
  };

  const moneyBlock = {
    amount: money2(num(estimate.amount)),
    currency: estimate.currency ?? "—",
    tax: estimate.tax ?? "—",
    tax_amount: estimate.tax_amount == null ? "—" : money2(num(estimate.tax_amount)),
    tax2: estimate.tax2 ?? "—",
    tax2_amount: estimate.tax2_amount == null ? "—" : money2(num(estimate.tax2_amount)),
    discount: estimate.discount ?? "—",
    discount_amount: estimate.discount_amount == null ? "—" : money2(num(estimate.discount_amount)),
  };

  const lifecycle = {
    sent_at: estimate.sent_at ?? "—",
    accepted_at: estimate.accepted_at ?? "—",
    declined_at: estimate.declined_at ?? "—",
  };

  const blocks: string[] = [
    renderObject({ estimate: header }),
    renderObject({ money: moneyBlock }),
    renderObject({ lifecycle }),
  ];

  // Public links from client_key + the account's base_uri (cached at auth setup).
  const clientKey = estimate.client_key as string | undefined;
  const baseUri = readConfig().profile_cache?.base_uri;
  if (clientKey && baseUri) {
    const url = `${baseUri.replace(/\/$/, "")}/client/estimates/${clientKey}`;
    blocks.push(renderObject({ links: { web: url, pdf: `${url}.pdf` } }));
  } else if (clientKey) {
    blocks.push(renderObject({ links: { client_key: clientKey, note: "run `harvest-axi auth whoami --refresh` to cache the account URL for full links" } }));
  }

  blocks.push(
    renderList("line_items", lineItems, [
      { name: "kind", extract: (i) => i.kind ?? "—" },
      { name: "description", extract: (i) => i.description ?? "—" },
      { name: "quantity", extract: (i) => i.quantity ?? "—" },
      { name: "unit_price", extract: (i) => i.unit_price ?? "—" },
      { name: "amount", extract: (i) => money2(num(i.amount)) },
      { name: "taxed", extract: (i) => i.taxed },
    ]),
  );

  if (messages.items.length > 0) {
    blocks.push(
      renderList("messages", messages.items, [
        { name: "sent_at", extract: (i) => i.sent_at ?? i.created_at ?? "—" },
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
