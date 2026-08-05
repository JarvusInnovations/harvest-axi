import { AxiError } from "axi-sdk-js";
import {
  normalizeArgs,
  rejectInertExportFlag,
  rejectUnknownFlag,
  rejectUnknownPositional,
} from "../cli/args.js";
import { readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity } from "../harvest/resolve.js";
import type { QueryValue } from "../harvest/client.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";
import { parseRange, type RangeFlags, NAMED_WINDOWS } from "../time/ranges.js";

export const INVOICES_HELP = `usage: harvest-axi invoices [get|create|edit|delete] [args] [flags]
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
writes — DRAFT WORKBENCH (create yields a draft; edit/delete act on drafts only):
  create                   new draft (free-form lines or --from-tracked)
  edit <id>                change a DRAFT's fields / line items
  delete <id>              delete a DRAFT (idempotent)
create/edit fields:
  --client <id|name>       (create, required)
  --subject <text>  --notes <text>  --po <text>
  --issue-date <date>  --due-date <date>  --payment-term <term>
  --tax <pct>  --tax2 <pct>  --discount <pct>  --currency <code>
  --payment-options <list> comma-separated: ach,credit_card,paypal
  --line "<kind>|<unit_price>|<qty>|<desc>|<project>"  add a line (repeatable;
                           trailing project is optional, id|name resolved)
  --update-line "<id>|<kind>|<unit_price>|<qty>|<desc>|<project>"  edit a line
                           (blank segment = keep; trailing project optional)
  --remove-line <id>       delete a line (repeatable)
create --from-tracked (build a draft from tracked time/expenses):
  --from-tracked           import mode
  --project <id|name>      project to bill (repeatable, ≥1 required)
  --summary <t>            project | task | people | detailed (default project)
  --from <date> --to <date>   time window (omit → all unbilled)
  --expenses               also import expenses
  --expense-summary <t>    project | category | people | detailed (default project)
NOT supported by design (do these in Harvest): send/email, mark-as-sent,
  close/re-open, record payment. harvest-axi never leaves draft state.
examples:
  harvest-axi invoices --drafts
  harvest-axi invoices get 13150403
  harvest-axi invoices create --client "Caltrans" --line "Service|200|10|May work|GTFS"
  harvest-axi invoices create --client "Acme" --from-tracked --project "GTFS" --last-month
  harvest-axi invoices edit 13150403 --notes "revised" --remove-line 998877
  harvest-axi invoices delete 13150403
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

const LIST_FLAGS = [
  "--from",
  "--to",
  "--since",
  "--client",
  "--project",
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
      case "--project":
        flags.project = next;
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
        if (arg.startsWith("--")) rejectUnknownFlag(arg, LIST_FLAGS, "invoices");
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

export async function invoicesCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return INVOICES_HELP;

  switch (args[0]) {
    case "get":
      return invoiceDetail(requireInvoiceId(args[1], "get"), args.slice(2));
    case "create":
      return invoiceCreate(args.slice(1));
    case "edit":
      return invoiceEdit(requireInvoiceId(args[1], "edit"), args.slice(2));
    case "delete":
      return invoiceDelete(requireInvoiceId(args[1], "delete"));
    default:
      return invoiceList(args);
  }
}

function requireInvoiceId(value: string | undefined, sub: string): string {
  if (!value || value.startsWith("--") || !/^\d+$/.test(value)) {
    throw new AxiError(`invoices ${sub} requires a numeric invoice id`, "VALIDATION_ERROR", [
      "Run `harvest-axi invoices` to list invoices and their ids",
    ]);
  }
  return value;
}

async function invoiceList(args: string[]): Promise<string> {
  const positionals: string[] = [];
  const flags = parseListFlags(args, positionals);
  // A stray positional here is almost always a mistyped subcommand
  // (`invoices detail 123`), which would otherwise silently list everything.
  if (positionals.length > 0) {
    rejectUnknownPositional(
      positionals[0],
      "invoices",
      "Valid subcommands: get, create, edit, delete — or run `harvest-axi invoices` with flags only to list",
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

  const suggestions: string[] = [
    "Run `harvest-axi invoices get <id>` for one invoice's full detail",
  ];
  if (capped) {
    suggestions.unshift(
      `Showing ${flags.limit} of ${sorted.length} matched invoices — raise --limit or narrow the filters`,
    );
  }
  if (!flags.state)
    suggestions.push("Run `harvest-axi invoices --drafts` to review draft invoices");

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
  // `invoices get` takes no flags of its own. `--raw` used to live here and
  // claimed to dump untranslated JSON, but rendered TOON — see the removed-flag
  // hint in cli/args.ts.
  for (const arg of normalizeArgs(rest)) {
    if (arg === "--json-out" || arg === "--csv-out") rejectInertExportFlag(arg, "invoices get");
    if (arg.startsWith("--")) rejectUnknownFlag(arg, [], "invoices get");
    rejectUnknownPositional(
      arg,
      "invoices get",
      "`invoices get <id>` takes an id and no further arguments",
    );
  }
  const invoice = await harvestRequest<Record<string, unknown>>(`invoices/${id}`);

  const payments = await paginateAll<Record<string, unknown>>(
    `invoices/${id}/payments`,
    "invoice_payments",
  );
  const messages = await paginateAll<Record<string, unknown>>(
    `invoices/${id}/messages`,
    "invoice_messages",
  );

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
    blocks.push(
      renderObject({
        links: {
          client_key: clientKey,
          note: "run `harvest-axi auth whoami --refresh` to cache the account URL for full links",
        },
      }),
    );
  }

  // References — only the present ones.
  const refs: Record<string, unknown> = {};
  if (invoice.estimate)
    refs.estimate = (invoice.estimate as { id?: number }).id ?? invoice.estimate;
  if (invoice.retainer)
    refs.retainer = (invoice.retainer as { id?: number }).id ?? invoice.retainer;
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

/** Top-level invoice fields settable on create/edit, parsed from flags. */
interface WriteFlags {
  client?: string;
  subject?: string;
  notes?: string;
  po?: string;
  issueDate?: string;
  dueDate?: string;
  paymentTerm?: string;
  paymentOptions?: string;
  currency?: string;
  tax?: string;
  tax2?: string;
  discount?: string;
  lines: string[]; // --line "kind|unit_price|qty|desc"
  updateLines: string[]; // --update-line "id|kind|unit_price|qty|desc"
  removeLines: string[]; // --remove-line <id>
  fromTracked: boolean;
  projects: string[];
  summary?: string;
  from?: string;
  to?: string;
  expenses: boolean;
  expenseSummary?: string;
}

const INVOICE_WRITE_FLAGS = [
  "--client",
  "--subject",
  "--notes",
  "--po",
  "--issue-date",
  "--due-date",
  "--payment-term",
  "--payment-options",
  "--currency",
  "--tax",
  "--tax2",
  "--discount",
  "--line",
  "--update-line",
  "--remove-line",
  "--from-tracked",
  "--project",
  "--summary",
  "--from",
  "--to",
  "--expenses",
  "--expense-summary",
] as const;

function parseWriteFlags(rawArgs: string[], command: string): WriteFlags {
  const f: WriteFlags = {
    lines: [],
    updateLines: [],
    removeLines: [],
    projects: [],
    fromTracked: false,
    expenses: false,
  };
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
      case "--due-date":
        f.dueDate = n;
        i++;
        break;
      case "--payment-term":
        f.paymentTerm = n;
        i++;
        break;
      case "--payment-options":
        f.paymentOptions = n;
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
      case "--from-tracked":
        f.fromTracked = true;
        break;
      case "--project":
        f.projects.push(n);
        i++;
        break;
      case "--summary":
        f.summary = n;
        i++;
        break;
      case "--from":
        f.from = n;
        i++;
        break;
      case "--to":
        f.to = n;
        i++;
        break;
      case "--expenses":
        f.expenses = true;
        break;
      case "--expense-summary":
        f.expenseSummary = n;
        i++;
        break;
      default:
        if (a === "--json-out" || a === "--csv-out") rejectInertExportFlag(a, command);
        if (a.startsWith("--")) rejectUnknownFlag(a, INVOICE_WRITE_FLAGS, command);
        rejectUnknownPositional(
          a,
          command,
          `\`${command}\` takes flags only — run \`harvest-axi invoices --help\` for usage`,
        );
    }
  }
  return f;
}

const PAYMENT_OPTIONS = ["ach", "credit_card", "paypal"] as const;

/**
 * Parse `--payment-options ach,credit_card` into a validated array. We can only
 * check the vocabulary client-side — an option valid here but not enabled on the
 * account surfaces a translated Harvest 422 at write time.
 */
function parsePaymentOptions(value: string): string[] {
  const opts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of opts) {
    if (!(PAYMENT_OPTIONS as readonly string[]).includes(o)) {
      throw new AxiError(`--payment-options got "${o}"`, "VALIDATION_ERROR", [
        `Valid options: ${PAYMENT_OPTIONS.join(", ")}`,
      ]);
    }
  }
  return opts;
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
 * A parsed line spec: the line-item body plus the optional raw `project` token
 * (id|name) to resolve to `project_id` before any mutation. Project resolution
 * is async and batched separately so syntax parsing stays synchronous/fail-fast.
 */
interface ParsedLine {
  item: Record<string, unknown>;
  project?: string;
}

/**
 * Parse a `--line "kind|unit_price|qty|desc|project"` spec into a line-item body.
 * kind + unit_price are required; qty defaults to 1; desc + project optional.
 * The trailing project is positional-last, so a literal `|` in the description
 * is unsupported — an over-segmented spec errors loudly rather than silently
 * treating a desc fragment as the project.
 */
function parseLineItem(spec: string): ParsedLine {
  const parts = spec.split("|").map((s) => s.trim());
  if (parts.length > 5) {
    throw new AxiError(
      `--line has too many "|" segments (max 5: kind|unit_price|qty|desc|project) — got "${spec}"`,
      "VALIDATION_ERROR",
      [
        "A literal | in the description isn't supported — remove it",
        'Format: --line "Service|200|10|May consulting|GTFS"',
      ],
    );
  }
  const [kind, unitPrice, qty, desc, project] = parts;
  if (!kind || !unitPrice) {
    throw new AxiError(
      `--line needs at least "kind|unit_price" — got "${spec}"`,
      "VALIDATION_ERROR",
      ['Example: --line "Service|200|10|May consulting"'],
    );
  }
  const item: Record<string, unknown> = { kind, unit_price: numFlag("unit_price", unitPrice) };
  if (qty) item.quantity = numFlag("quantity", qty);
  if (desc) item.description = desc;
  return { item, project: project || undefined };
}

/** Parse `--update-line "id|kind|unit_price|qty|desc|project"` — blank fields are left unchanged. */
function parseUpdateLine(spec: string): ParsedLine {
  const parts = spec.split("|").map((s) => s.trim());
  if (parts.length > 6) {
    throw new AxiError(
      `--update-line has too many "|" segments (max 6: id|kind|unit_price|qty|desc|project) — got "${spec}"`,
      "VALIDATION_ERROR",
      [
        "A literal | in the description isn't supported — remove it",
        'Format: --update-line "998877|Service|220||revised rate|GTFS"',
      ],
    );
  }
  const [id, kind, unitPrice, qty, desc, project] = parts;
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
  return { item, project: project || undefined };
}

/**
 * Resolve each parsed line's optional project token to `project_id`, returning
 * the line-item bodies. Unique tokens are resolved once, in parallel, **before**
 * any mutation — an unknown/ambiguous name fails fast with candidates rather
 * than producing a partially-linked draft. A blank token leaves the key unset
 * (on `--update-line` that means "keep the existing link").
 */
async function resolveLineProjects(lines: ParsedLine[]): Promise<Record<string, unknown>[]> {
  const tokens = [...new Set(lines.map((l) => l.project).filter((t): t is string => !!t))];
  const ids = new Map<string, number>();
  await Promise.all(
    tokens.map(async (t) => {
      ids.set(t, (await resolveEntity("project", t)).id);
    }),
  );
  return lines.map(({ item, project }) => {
    if (project) item.project_id = ids.get(project);
    return item;
  });
}

/** Build the shared top-level body (subject/notes/dates/tax/...) from flags. */
function buildTopLevel(f: WriteFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.subject !== undefined) body.subject = f.subject;
  if (f.notes !== undefined) body.notes = f.notes;
  if (f.po !== undefined) body.purchase_order = f.po;
  if (f.paymentOptions !== undefined) body.payment_options = parsePaymentOptions(f.paymentOptions);
  if (f.issueDate) body.issue_date = f.issueDate;
  if (f.paymentTerm) body.payment_term = f.paymentTerm;
  if (f.currency) body.currency = f.currency;
  if (f.tax !== undefined) body.tax = numFlag("--tax", f.tax);
  if (f.tax2 !== undefined) body.tax2 = numFlag("--tax2", f.tax2);
  if (f.discount !== undefined) body.discount = numFlag("--discount", f.discount);
  if (f.dueDate) {
    // A custom due_date requires payment_term: custom (else the API computes it).
    if (f.paymentTerm && f.paymentTerm !== "custom") {
      throw new AxiError(
        `--due-date needs --payment-term custom (you passed "${f.paymentTerm}")`,
        "VALIDATION_ERROR",
        ["Either drop --due-date and let the term compute it, or pass --payment-term custom"],
      );
    }
    body.payment_term = "custom";
    body.due_date = f.dueDate;
  }
  return body;
}

/**
 * Draft-only guard: fetch the invoice and refuse unless it's a draft. The
 * Harvest API does not gate edit/delete by state — this is harvest-axi's
 * workbench safety convention, enforced before any mutation. Returns the
 * fetched invoice (so callers needn't re-GET). NOT_FOUND propagates.
 */
async function requireDraft(id: string, action: string): Promise<Record<string, unknown>> {
  const invoice = await harvestRequest<Record<string, unknown>>(`invoices/${id}`);
  if (invoice.state !== "draft") {
    throw new AxiError(
      `invoice #${id} is "${invoice.state}", not a draft — harvest-axi only ${action}s drafts`,
      "VALIDATION_ERROR",
      [
        "harvest-axi is a draft workbench; finalize, send, close, and payments are done in Harvest",
        `Run \`harvest-axi invoices get ${id}\` to inspect it`,
      ],
    );
  }
  return invoice;
}

function createdSummary(status: string, inv: Record<string, unknown>): string {
  const lineItems = (inv.line_items as Record<string, unknown>[]) ?? [];
  const header = renderObject({
    status,
    id: inv.id,
    number: inv.number ?? "—",
    state: inv.state,
    client: nestedName(inv, "client"),
    amount: money2(num(inv.amount)),
    line_items: lineItems.length,
  });
  if (lineItems.length === 0) return header;
  // Echo the resulting lines with their project link so the linkage is
  // confirmable without a follow-up `get`.
  return joinBlocks(
    header,
    renderList("line_items", lineItems, [
      { name: "id", extract: (i) => i.id ?? "—" },
      { name: "kind", extract: (i) => i.kind ?? "—" },
      { name: "description", extract: (i) => i.description ?? "—" },
      { name: "project", extract: (i) => nestedName(i, "project") },
      { name: "quantity", extract: (i) => i.quantity ?? "—" },
      { name: "unit_price", extract: (i) => i.unit_price ?? "—" },
      { name: "amount", extract: (i) => money2(num(i.amount)) },
    ]),
  );
}

async function invoiceCreate(args: string[]): Promise<string> {
  const f = parseWriteFlags(args, "invoices create");
  if (!f.client) {
    throw new AxiError("`invoices create` requires --client", "VALIDATION_ERROR", [
      "Run `harvest-axi browse clients` to find a client id or name",
    ]);
  }
  // Resolve the client name → id before any mutation (fail fast).
  const client = await resolveEntity("client", f.client);
  const body = buildTopLevel(f);
  body.client_id = client.id;

  if (f.fromTracked) {
    if (f.projects.length === 0) {
      throw new AxiError("`--from-tracked` requires at least one --project", "VALIDATION_ERROR", [
        "Run `harvest-axi browse projects` to find projects to bill",
      ]);
    }
    if (f.lines.length > 0) {
      throw new AxiError(
        "`--from-tracked` and `--line` are mutually exclusive",
        "VALIDATION_ERROR",
        ["Use --from-tracked to import time, OR --line for free-form items — not both"],
      );
    }
    const projectIds = await Promise.all(
      f.projects.map((p) => resolveEntity("project", p).then((e) => e.id)),
    );
    const importBlock: Record<string, unknown> = { project_ids: projectIds };
    const time: Record<string, unknown> = { summary_type: f.summary ?? "project" };
    if (f.from) time.from = f.from;
    if (f.to) time.to = f.to;
    importBlock.time = time;
    if (f.expenses) {
      const exp: Record<string, unknown> = { summary_type: f.expenseSummary ?? "project" };
      if (f.from) exp.from = f.from;
      if (f.to) exp.to = f.to;
      importBlock.expenses = exp;
    }
    body.line_items_import = importBlock;
  } else {
    if (f.lines.length === 0) {
      throw new AxiError(
        "`invoices create` needs --line items or --from-tracked",
        "VALIDATION_ERROR",
        [
          'Free-form: --line "Service|200|10|May work" (repeatable)',
          "From tracked time: --from-tracked --project <name>",
        ],
      );
    }
    body.line_items = await resolveLineProjects(f.lines.map(parseLineItem));
  }

  const created = await harvestRequest<Record<string, unknown>>("invoices", {
    method: "POST",
    body,
  });
  return joinBlocks(
    createdSummary("draft created", created),
    renderHelp([
      `Run \`harvest-axi invoices get ${created.id}\` to review the draft`,
      "Finalize and send it in Harvest when ready (harvest-axi keeps it a draft)",
    ]),
  );
}

async function invoiceEdit(id: string, args: string[]): Promise<string> {
  const f = parseWriteFlags(args, "invoices edit");
  // Guard first — no mutation on a non-draft. The guard's GET is also the source
  // for payment_options preservation below (no extra round-trip).
  const current = await requireDraft(id, "edit");

  const body = buildTopLevel(f);
  // Parse everything synchronously first (syntax fail-fast), then resolve the
  // add/update project tokens before the PATCH. Destroy ops carry no project.
  const parsed = [...f.lines.map(parseLineItem), ...f.updateLines.map(parseUpdateLine)];
  const removes = f.removeLines.map((rid) => {
    if (!/^\d+$/.test(rid)) {
      throw new AxiError(
        `--remove-line needs a numeric line id, got "${rid}"`,
        "VALIDATION_ERROR",
        [],
      );
    }
    return { id: Number(rid), _destroy: true };
  });
  const lineItems: Record<string, unknown>[] = [...(await resolveLineProjects(parsed)), ...removes];
  if (lineItems.length > 0) body.line_items = lineItems;

  if (Object.keys(body).length === 0) {
    throw new AxiError(
      "`invoices edit` needs at least one field or line change",
      "VALIDATION_ERROR",
      ["e.g. --notes, --subject, --due-date, --line, --update-line, --remove-line"],
    );
  }

  // Harvest clears payment_options on any PATCH that omits the field (it is NOT
  // partial-update — unlike every other field). When --payment-options wasn't
  // passed, re-send the draft's existing options so an unrelated edit doesn't
  // silently drop ACH/credit-card/PayPal. `--payment-options ""` (sets [] in
  // buildTopLevel) remains the explicit clear path. See spec + issue #9.
  if (
    f.paymentOptions === undefined &&
    Array.isArray(current.payment_options) &&
    current.payment_options.length > 0
  ) {
    body.payment_options = current.payment_options;
  }

  const updated = await harvestRequest<Record<string, unknown>>(`invoices/${id}`, {
    method: "PATCH",
    body,
  });
  return joinBlocks(
    createdSummary("draft updated", updated),
    renderHelp([`Run \`harvest-axi invoices get ${id}\` to see the full updated draft`]),
  );
}

async function invoiceDelete(id: string): Promise<string> {
  // Guard first — refuse non-drafts; NOT_FOUND → idempotent no-op.
  try {
    await requireDraft(id, "delete");
  } catch (err) {
    if (err instanceof AxiError && err.code === "NOT_FOUND") {
      return renderObject({ status: `invoice ${id} not found (no-op)`, id });
    }
    throw err;
  }
  await harvestRequest(`invoices/${id}`, { method: "DELETE" });
  return renderObject({ status: "draft deleted", id });
}
