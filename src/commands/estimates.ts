import { AxiError } from "axi-sdk-js";
import { normalizeArgs, rejectUnknownFlag, rejectUnknownPositional } from "../cli/args.js";
import { readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity } from "../harvest/resolve.js";
import type { QueryValue } from "../harvest/client.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";
import { parseRange, type RangeFlags, NAMED_WINDOWS } from "../time/ranges.js";

export const ESTIMATES_HELP = `usage: harvest-axi estimates [get|create|edit|delete] [args] [flags]
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
writes — DRAFT WORKBENCH (create yields a draft; edit/delete act on drafts only):
  create                   new draft (free-form lines)
  edit <id>                change a DRAFT's fields / line items
  delete <id>              delete a DRAFT (idempotent)
create/edit fields:
  --client <id|name>       (create, required)
  --subject <text>  --notes <text>  --po <text>
  --issue-date <date>  --currency <code>
  --tax <pct>  --tax2 <pct>  --discount <pct>
  --line "<kind>|<unit_price>|<qty>|<desc>"  add a line (repeatable; estimate
                           lines are NOT project-linked — no trailing project)
  --update-line "<id>|<kind>|<unit_price>|<qty>|<desc>"  edit a line
                           (blank segment = keep)
  --remove-line <id>       delete a line (repeatable)
NOT supported by design (do these in Harvest): send/email, mark-as-sent,
  accept/decline/re-open. harvest-axi never leaves draft state.
examples:
  harvest-axi estimates --drafts
  harvest-axi estimates get 13150403
  harvest-axi estimates create --client "Caltrans" --line "Service|200|10|Phase 1 scope"
  harvest-axi estimates edit 13150403 --notes "revised" --remove-line 998877
  harvest-axi estimates delete 13150403
`;

const STATES = ["draft", "sent", "accepted", "declined"] as const;
type State = (typeof STATES)[number];

interface ListFlags {
  range: RangeFlags;
  state?: State;
  client?: string;
  limit: number;
}

const LIST_FLAGS = [
  "--from",
  "--to",
  "--since",
  "--client",
  "--drafts",
  "--limit",
  "--state",
  ...NAMED_WINDOWS.map((w) => `--${w}`),
] as const;

function parseListFlags(rawArgs: string[], positionals: string[] = []): ListFlags {
  const flags: ListFlags = { range: {}, limit: 200 };
  const args = normalizeArgs(rawArgs);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--from":
        flags.range.from = next;
        i++;
        break;
      case "--to":
        flags.range.to = next;
        i++;
        break;
      case "--since":
        flags.range.since = next;
        i++;
        break;
      case "--client":
        flags.client = next;
        i++;
        break;
      case "--drafts":
        flags.state = "draft";
        break;
      case "--limit":
        flags.limit = Math.max(1, parseInt(next, 10) || 200);
        i++;
        break;
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
          break;
        }
        if (arg.startsWith("--")) rejectUnknownFlag(arg, LIST_FLAGS, "estimates");
        positionals.push(arg);
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
  (entry[key] as { name?: string } | undefined)?.name ?? "—";

export async function estimatesCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return ESTIMATES_HELP;

  switch (args[0]) {
    case "get":
      return estimateDetail(requireEstimateId(args[1], "get"), args.slice(2));
    case "create":
      return estimateCreate(args.slice(1));
    case "edit":
      return estimateEdit(requireEstimateId(args[1], "edit"), args.slice(2));
    case "delete":
      return estimateDelete(requireEstimateId(args[1], "delete"));
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
  const positionals: string[] = [];
  const flags = parseListFlags(args, positionals);
  // A stray positional is almost always a mistyped subcommand, which would
  // otherwise silently list everything.
  if (positionals.length > 0) {
    rejectUnknownPositional(
      positionals[0],
      "estimates",
      "Valid subcommands: get, create, edit, delete — or run `harvest-axi estimates` with flags only to list",
    );
  }
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

  const suggestions: string[] = [
    "Run `harvest-axi estimates get <id>` for one estimate's full detail",
  ];
  if (capped) {
    suggestions.unshift(
      `Showing ${flags.limit} of ${sorted.length} matched estimates — raise --limit or narrow the filters`,
    );
  }
  if (!flags.state)
    suggestions.push("Run `harvest-axi estimates --drafts` to review draft estimates");

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
  // `estimates get` takes no flags of its own — see the `--raw` removed-flag
  // hint in cli/args.ts.
  for (const arg of normalizeArgs(rest)) {
    if (arg.startsWith("--")) rejectUnknownFlag(arg, [], "estimates get");
    rejectUnknownPositional(
      arg,
      "estimates get",
      "`estimates get <id>` takes an id and no further arguments",
    );
  }
  const estimate = await harvestRequest<Record<string, unknown>>(`estimates/${id}`);

  const messages = await paginateAll<Record<string, unknown>>(
    `estimates/${id}/messages`,
    "estimate_messages",
  );

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
    blocks.push(
      renderObject({
        links: {
          client_key: clientKey,
          note: "run `harvest-axi auth whoami --refresh` to cache the account URL for full links",
        },
      }),
    );
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
              ? (i.recipients as Array<{ email?: string }>)
                  .map((r) => r.email)
                  .filter(Boolean)
                  .join(", ") || "—"
              : "—",
        },
        { name: "subject", extract: (i) => i.subject ?? "—" },
      ]),
    );
  }

  return joinBlocks(...blocks);
}

// ── Writes — draft workbench ────────────────────────────────────────────────

/** Top-level estimate fields settable on create/edit, parsed from flags. */
interface WriteFlags {
  client?: string;
  subject?: string;
  notes?: string;
  po?: string;
  issueDate?: string;
  currency?: string;
  tax?: string;
  tax2?: string;
  discount?: string;
  lines: string[]; // --line "kind|unit_price|qty|desc"
  updateLines: string[]; // --update-line "id|kind|unit_price|qty|desc"
  removeLines: string[]; // --remove-line <id>
}

const ESTIMATE_WRITE_FLAGS = [
  "--client",
  "--subject",
  "--notes",
  "--po",
  "--issue-date",
  "--currency",
  "--tax",
  "--tax2",
  "--discount",
  "--line",
  "--update-line",
  "--remove-line",
] as const;

function parseWriteFlags(rawArgs: string[], command: string): WriteFlags {
  const f: WriteFlags = { lines: [], updateLines: [], removeLines: [] };
  const args = normalizeArgs(rawArgs);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const n = args[i + 1];
    switch (a) {
      case "--client":
        f.client = n;
        i++;
        break;
      case "--subject":
        f.subject = n;
        i++;
        break;
      case "--notes":
        f.notes = n;
        i++;
        break;
      case "--po":
        f.po = n;
        i++;
        break;
      case "--issue-date":
        f.issueDate = n;
        i++;
        break;
      case "--currency":
        f.currency = n;
        i++;
        break;
      case "--tax":
        f.tax = n;
        i++;
        break;
      case "--tax2":
        f.tax2 = n;
        i++;
        break;
      case "--discount":
        f.discount = n;
        i++;
        break;
      case "--line":
        f.lines.push(n);
        i++;
        break;
      case "--update-line":
        f.updateLines.push(n);
        i++;
        break;
      case "--remove-line":
        f.removeLines.push(n);
        i++;
        break;
      default:
        if (a.startsWith("--")) rejectUnknownFlag(a, ESTIMATE_WRITE_FLAGS, command);
        rejectUnknownPositional(
          a,
          command,
          `\`${command}\` takes flags only — run \`harvest-axi estimates --help\` for usage`,
        );
    }
  }
  return f;
}

/** Parse a number flag or throw a clear VALIDATION_ERROR (percentages, prices). */
function numFlag(name: string, value: string): number {
  const v = Number(value);
  if (Number.isNaN(v)) {
    throw new AxiError(`${name} must be a number, got "${value}"`, "VALIDATION_ERROR", []);
  }
  return v;
}

/**
 * Parse a `--line "kind|unit_price|qty|desc"` spec into a line-item body.
 * kind + unit_price are required; qty defaults to 1; desc optional. Estimate
 * line items carry no project link, so there is no trailing project segment —
 * an over-segmented spec errors loudly rather than swallowing a stray token.
 */
function parseLineItem(spec: string): Record<string, unknown> {
  const parts = spec.split("|").map((s) => s.trim());
  if (parts.length > 4) {
    throw new AxiError(
      `--line has too many "|" segments (max 4: kind|unit_price|qty|desc) — got "${spec}"`,
      "VALIDATION_ERROR",
      [
        "Estimate line items aren't project-linked — there's no trailing project segment",
        'Format: --line "Service|200|10|Phase 1 scope"',
      ],
    );
  }
  const [kind, unitPrice, qty, desc] = parts;
  if (!kind || !unitPrice) {
    throw new AxiError(
      `--line needs at least "kind|unit_price" — got "${spec}"`,
      "VALIDATION_ERROR",
      ['Example: --line "Service|200|10|Phase 1 scope"'],
    );
  }
  const item: Record<string, unknown> = { kind, unit_price: numFlag("unit_price", unitPrice) };
  if (qty) item.quantity = numFlag("quantity", qty);
  if (desc) item.description = desc;
  return item;
}

/** Parse `--update-line "id|kind|unit_price|qty|desc"` — blank fields are left unchanged. */
function parseUpdateLine(spec: string): Record<string, unknown> {
  const parts = spec.split("|").map((s) => s.trim());
  if (parts.length > 5) {
    throw new AxiError(
      `--update-line has too many "|" segments (max 5: id|kind|unit_price|qty|desc) — got "${spec}"`,
      "VALIDATION_ERROR",
      [
        "Estimate line items aren't project-linked — there's no trailing project segment",
        'Format: --update-line "998877|Service|220||revised rate"',
      ],
    );
  }
  const [id, kind, unitPrice, qty, desc] = parts;
  if (!id || !/^\d+$/.test(id)) {
    throw new AxiError(
      `--update-line needs a numeric line id first — got "${spec}"`,
      "VALIDATION_ERROR",
      ['Example: --update-line "998877|Service|220||revised rate"'],
    );
  }
  const item: Record<string, unknown> = { id: Number(id) };
  if (kind) item.kind = kind;
  if (unitPrice) item.unit_price = numFlag("unit_price", unitPrice);
  if (qty) item.quantity = numFlag("quantity", qty);
  if (desc) item.description = desc;
  return item;
}

/** Build the shared top-level body (subject/notes/dates/tax/...) from flags. */
function buildTopLevel(f: WriteFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.subject !== undefined) body.subject = f.subject;
  if (f.notes !== undefined) body.notes = f.notes;
  if (f.po !== undefined) body.purchase_order = f.po;
  if (f.issueDate) body.issue_date = f.issueDate;
  if (f.currency) body.currency = f.currency;
  if (f.tax !== undefined) body.tax = numFlag("--tax", f.tax);
  if (f.tax2 !== undefined) body.tax2 = numFlag("--tax2", f.tax2);
  if (f.discount !== undefined) body.discount = numFlag("--discount", f.discount);
  return body;
}

/**
 * Draft-only guard: fetch the estimate and refuse unless it's a draft. The
 * Harvest API does not gate edit/delete by state — this is harvest-axi's
 * workbench safety convention, enforced before any mutation. Returns the
 * fetched estimate (so callers needn't re-GET). NOT_FOUND propagates.
 */
async function requireDraft(id: string, action: string): Promise<Record<string, unknown>> {
  const estimate = await harvestRequest<Record<string, unknown>>(`estimates/${id}`);
  if (estimate.state !== "draft") {
    throw new AxiError(
      `estimate #${id} is "${estimate.state}", not a draft — harvest-axi only ${action}s drafts`,
      "VALIDATION_ERROR",
      [
        "harvest-axi is a draft workbench; finalize, send, accept, and decline are done in Harvest",
        `Run \`harvest-axi estimates get ${id}\` to inspect it`,
      ],
    );
  }
  return estimate;
}

function createdSummary(status: string, est: Record<string, unknown>): string {
  const lineItems = (est.line_items as Record<string, unknown>[]) ?? [];
  const header = renderObject({
    status,
    id: est.id,
    number: est.number ?? "—",
    state: est.state,
    client: nestedName(est, "client"),
    amount: money2(num(est.amount)),
    line_items: lineItems.length,
  });
  if (lineItems.length === 0) return header;
  // Echo the resulting lines so the result is confirmable without a follow-up
  // `get`.
  return joinBlocks(
    header,
    renderList("line_items", lineItems, [
      { name: "id", extract: (i) => i.id ?? "—" },
      { name: "kind", extract: (i) => i.kind ?? "—" },
      { name: "description", extract: (i) => i.description ?? "—" },
      { name: "quantity", extract: (i) => i.quantity ?? "—" },
      { name: "unit_price", extract: (i) => i.unit_price ?? "—" },
      { name: "amount", extract: (i) => money2(num(i.amount)) },
    ]),
  );
}

async function estimateCreate(args: string[]): Promise<string> {
  const f = parseWriteFlags(args, "estimates create");
  if (!f.client) {
    throw new AxiError("`estimates create` requires --client", "VALIDATION_ERROR", [
      "Run `harvest-axi browse clients` to find a client id or name",
    ]);
  }
  // Resolve the client name → id before any mutation (fail fast).
  const client = await resolveEntity("client", f.client);
  const body = buildTopLevel(f);
  body.client_id = client.id;

  if (f.lines.length === 0) {
    throw new AxiError("`estimates create` needs --line items", "VALIDATION_ERROR", [
      'Free-form: --line "Service|200|10|Phase 1 scope" (repeatable)',
    ]);
  }
  body.line_items = f.lines.map(parseLineItem);

  const created = await harvestRequest<Record<string, unknown>>("estimates", {
    method: "POST",
    body,
  });
  return joinBlocks(
    createdSummary("draft created", created),
    renderHelp([
      `Run \`harvest-axi estimates get ${created.id}\` to review the draft`,
      "Finalize and send it in Harvest when ready (harvest-axi keeps it a draft)",
    ]),
  );
}

async function estimateEdit(id: string, args: string[]): Promise<string> {
  const f = parseWriteFlags(args, "estimates edit");
  // Guard first — no mutation on a non-draft.
  await requireDraft(id, "edit");

  const body = buildTopLevel(f);
  // Add/update line bodies + destroy ops. No project resolution — estimate
  // lines aren't project-linked. (And no payment_options preservation step:
  // estimates have no such field, so every PATCH field is honest partial-update.)
  const lineItems: Record<string, unknown>[] = [
    ...f.lines.map(parseLineItem),
    ...f.updateLines.map(parseUpdateLine),
    ...f.removeLines.map((rid) => {
      if (!/^\d+$/.test(rid)) {
        throw new AxiError(
          `--remove-line needs a numeric line id, got "${rid}"`,
          "VALIDATION_ERROR",
          [],
        );
      }
      return { id: Number(rid), _destroy: true };
    }),
  ];
  if (lineItems.length > 0) body.line_items = lineItems;

  if (Object.keys(body).length === 0) {
    throw new AxiError(
      "`estimates edit` needs at least one field or line change",
      "VALIDATION_ERROR",
      ["e.g. --notes, --subject, --issue-date, --line, --update-line, --remove-line"],
    );
  }

  const updated = await harvestRequest<Record<string, unknown>>(`estimates/${id}`, {
    method: "PATCH",
    body,
  });
  return joinBlocks(
    createdSummary("draft updated", updated),
    renderHelp([`Run \`harvest-axi estimates get ${id}\` to see the full updated draft`]),
  );
}

async function estimateDelete(id: string): Promise<string> {
  // Guard first — refuse non-drafts; NOT_FOUND → idempotent no-op.
  try {
    await requireDraft(id, "delete");
  } catch (err) {
    if (err instanceof AxiError && err.code === "NOT_FOUND") {
      return renderObject({ status: `estimate ${id} not found (no-op)`, id });
    }
    throw err;
  }
  await harvestRequest(`estimates/${id}`, { method: "DELETE" });
  return renderObject({ status: "draft deleted", id });
}
