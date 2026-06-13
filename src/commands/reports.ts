import { AxiError } from "axi-sdk-js";
import type { QueryValue } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { joinBlocks, renderHelp, renderList, renderObject, type FieldDef } from "../output/index.js";
import { parseRange, type RangeFlags, NAMED_WINDOWS } from "../time/ranges.js";

export const REPORTS_HELP = `usage: harvest-axi reports <type> [axis] [window] [flags]
types[7]:
  clients | projects | tasks | team    server-aggregated time totals + billable $
  uninvoiced                           tracked work not yet invoiced (per project)
  expenses <clients|projects|categories|team>   expense totals
  budget                               project budget vs spent (point-in-time)
time window (see date-ranges; max span 365 days):
  --since <dur>        7d | 2w | 1m
  --from <date> --to <date>
  --today --yesterday --this-week --last-week --this-month --last-month
  (time/expense default to this-month; uninvoiced REQUIRES a window; budget takes none)
flags:
  --fixed-fee          include billable amounts for fixed-fee projects (time only)
  --all                include inactive projects (budget only)
examples:
  harvest-axi reports projects --this-month
  harvest-axi reports uninvoiced --from 2026-01-01 --to 2026-03-31
  harvest-axi reports expenses projects --last-month
  harvest-axi reports budget
note:
  reports = server-aggregated totals. For per-entry detail or flexible
  grouping, use \`harvest-axi review\`.
`;

type Axis = "clients" | "projects" | "tasks" | "team";
const AXES: Axis[] = ["clients", "projects", "tasks", "team"];
const ALL_REPORTS = [...AXES, "uninvoiced", "expenses", "budget"] as const;
const EXPENSE_AXES = ["clients", "projects", "categories", "team"] as const;
type ExpenseAxis = (typeof EXPENSE_AXES)[number];

// Singular column name per axis row.
const ROW_NAME: Record<Axis, string> = {
  clients: "client",
  projects: "project",
  tasks: "task",
  team: "user",
};

interface ReportsFlags {
  range: RangeFlags;
  fixedFee: boolean;
  all: boolean;
}

/** True when the user supplied any window flag (used by no-default reports). */
function hasWindow(f: ReportsFlags): boolean {
  return !!(f.range.from || f.range.to || f.range.since || f.range.named);
}

function parseReportsFlags(args: string[]): ReportsFlags {
  const flags: ReportsFlags = { range: {}, fixedFee: false, all: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--from": flags.range.from = next; i++; break;
      case "--to": flags.range.to = next; i++; break;
      case "--since": flags.range.since = next; i++; break;
      case "--fixed-fee": flags.fixedFee = true; break;
      case "--all": flags.all = true; break;
      default:
        if (arg.startsWith("--") && (NAMED_WINDOWS as readonly string[]).includes(arg.slice(2))) {
          flags.range.named = arg.slice(2);
        }
        break;
    }
  }
  return flags;
}

function round2(n: unknown): number {
  return Math.round((typeof n === "number" ? n : Number(n) || 0) * 100) / 100;
}

function daySpan(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Guard the 365-day Reports-API span cap; throws VALIDATION_ERROR if exceeded. */
function assertSpan(from: string, to: string): void {
  if (daySpan(from, to) > 365) {
    throw new AxiError(
      `Reports span ${from} → ${to} exceeds the 365-day maximum`,
      "VALIDATION_ERROR",
      ["Narrow the window (e.g. --this-month, --from/--to within a year)"],
    );
  }
}

export async function reportsCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) return REPORTS_HELP;
  const report = args[0];
  if (!(ALL_REPORTS as readonly string[]).includes(report)) {
    throw new AxiError(`Unknown reports type: ${args[0]}`, "VALIDATION_ERROR", [
      `Valid: ${ALL_REPORTS.join(", ")}`,
    ]);
  }
  const rest = args.slice(1);
  if (rest.includes("--help")) return REPORTS_HELP;
  const flags = parseReportsFlags(rest);

  if (report === "uninvoiced") return uninvoicedReport(flags);
  if (report === "budget") return budgetReport(flags);
  if (report === "expenses") {
    // expenses takes a second positional axis: reports expenses <axis>.
    const axis = rest.find((a) => !a.startsWith("--"));
    return expenseReport(axis, flags);
  }

  const axis = report as Axis;
  const range = parseRange(flags.range, { defaultNamed: "this-month" });
  assertSpan(range.from, range.to);

  const query: Record<string, QueryValue> = { from: range.from, to: range.to };
  if (flags.fixedFee) query.include_fixed_fee = "true";

  const res = await paginateAll<Record<string, unknown>>(`reports/time/${axis}`, "results", query);
  const rows = res.items;

  // Totals.
  let totalHours = 0;
  let billableHours = 0;
  let amount = 0;
  const currencies = new Set<string>();
  for (const r of rows) {
    totalHours += typeof r.total_hours === "number" ? r.total_hours : 0;
    billableHours += typeof r.billable_hours === "number" ? r.billable_hours : 0;
    amount += typeof r.billable_amount === "number" ? r.billable_amount : 0;
    if (typeof r.currency === "string") currencies.add(r.currency);
  }
  const mixed = currencies.size > 1;
  const currency = currencies.size === 1 ? [...currencies][0] : undefined;

  const header: Record<string, unknown> = {
    range: range.label,
    report: axis,
    total_hours: round2(totalHours),
    billable_hours: round2(billableHours),
    billable_amount: mixed ? "(mixed currencies — not summed)" : `${round2(amount)}${currency ? ` ${currency}` : ""}`,
    rows: rows.length,
    complete: res.complete,
  };
  if (!res.complete) header.capped_at_pages = res.pages_fetched;

  if (rows.length === 0) {
    return joinBlocks(
      renderObject(header),
      renderObject({ [axis]: `0 ${axis} with tracked time in ${range.label}` }),
      renderHelp(["Broaden the window with --since / --from / --to"]),
    );
  }

  const name = ROW_NAME[axis];
  const schema: FieldDef[] = [{ name, extract: (i) => i[`${name}_name`] }];
  if (axis === "projects") schema.push({ name: "client", extract: (i) => i.client_name ?? "" });
  schema.push(
    { name: "hours", extract: (i) => round2(i.total_hours) },
    { name: "billable_hours", extract: (i) => round2(i.billable_hours) },
    { name: "amount", extract: (i) => round2(i.billable_amount) },
  );

  const sorted = [...rows].sort(
    (a, b) => (typeof b.total_hours === "number" ? b.total_hours : 0) - (typeof a.total_hours === "number" ? a.total_hours : 0),
  );

  const otherAxis = axis === "tasks" ? "projects" : "tasks";
  const windowFlag = flags.range.named ? ` --${flags.range.named}` : "";

  return joinBlocks(
    renderObject(header),
    renderList(axis, sorted, schema),
    renderHelp([
      `Run \`harvest-axi reports ${otherAxis}${windowFlag}\` to break down by another axis`,
      'Run `harvest-axi review --project "<name>" --by none` for the entries behind a row',
    ]),
  );
}

async function uninvoicedReport(flags: ReportsFlags): Promise<string> {
  // Unlike the time axes, uninvoiced has NO default window — the API requires
  // explicit from/to, so a bare `reports uninvoiced` is a fail-fast error.
  if (!hasWindow(flags)) {
    throw new AxiError("`reports uninvoiced` requires an explicit window", "VALIDATION_ERROR", [
      "Pass --from <date> --to <date>, --since <dur>, or a named window (--last-month, …)",
      "(uninvoiced has no default window, unlike the time axes)",
    ]);
  }
  const range = parseRange(flags.range);
  assertSpan(range.from, range.to);

  const query: Record<string, QueryValue> = { from: range.from, to: range.to };
  if (flags.fixedFee) query.include_fixed_fee = "true";

  const res = await paginateAll<Record<string, unknown>>("reports/uninvoiced", "results", query);
  const rows = res.items;

  let hours = 0;
  let uninvoicedHours = 0;
  let amount = 0;
  const currencies = new Set<string>();
  for (const r of rows) {
    hours += typeof r.total_hours === "number" ? r.total_hours : 0;
    uninvoicedHours += typeof r.uninvoiced_hours === "number" ? r.uninvoiced_hours : 0;
    amount += typeof r.uninvoiced_amount === "number" ? r.uninvoiced_amount : 0;
    if (typeof r.currency === "string") currencies.add(r.currency);
  }
  const mixed = currencies.size > 1;
  const currency = currencies.size === 1 ? [...currencies][0] : undefined;

  const header: Record<string, unknown> = {
    range: range.label,
    report: "uninvoiced",
    uninvoiced_amount: mixed ? "(mixed currencies — not summed)" : `${round2(amount)}${currency ? ` ${currency}` : ""}`,
    uninvoiced_hours: round2(uninvoicedHours),
    rows: rows.length,
    complete: res.complete,
  };
  if (!res.complete) header.capped_at_pages = res.pages_fetched;

  if (rows.length === 0) {
    return joinBlocks(
      renderObject(header),
      renderObject({ uninvoiced: `0 projects with uninvoiced work in ${range.label}` }),
      renderHelp(["Broaden the window with --from/--to or --since"]),
    );
  }

  const sorted = [...rows].sort(
    (a, b) =>
      (typeof b.uninvoiced_amount === "number" ? b.uninvoiced_amount : 0) -
      (typeof a.uninvoiced_amount === "number" ? a.uninvoiced_amount : 0),
  );

  return joinBlocks(
    renderObject(header),
    renderList("uninvoiced", sorted, [
      { name: "project", extract: (i) => i.project_name ?? "" },
      { name: "client", extract: (i) => i.client_name ?? "" },
      { name: "hours", extract: (i) => round2(i.total_hours) },
      { name: "uninvoiced_hours", extract: (i) => round2(i.uninvoiced_hours) },
      { name: "expenses", extract: (i) => round2(i.uninvoiced_expenses) },
      { name: "amount", extract: (i) => round2(i.uninvoiced_amount) },
    ]),
    renderHelp([
      'Run `harvest-axi invoices create --from-tracked --project "<name>"` to draft an invoice from this work',
      'Run `harvest-axi review --project "<name>" --unbilled` for the entries behind a row',
    ]),
  );
}

// Identity column per expense axis (the row's name field + output column name).
const EXPENSE_ID: Record<ExpenseAxis, { col: string; field: string }> = {
  clients: { col: "client", field: "client_name" },
  projects: { col: "project", field: "project_name" },
  categories: { col: "category", field: "expense_category_name" },
  team: { col: "user", field: "user_name" },
};

async function expenseReport(axisArg: string | undefined, flags: ReportsFlags): Promise<string> {
  if (!axisArg || !(EXPENSE_AXES as readonly string[]).includes(axisArg)) {
    throw new AxiError(`reports expenses needs an axis${axisArg ? ` (got "${axisArg}")` : ""}`, "VALIDATION_ERROR", [
      `Valid axes: ${EXPENSE_AXES.join(", ")}`,
      "e.g. `harvest-axi reports expenses projects --last-month`",
    ]);
  }
  const axis = axisArg as ExpenseAxis;
  const range = parseRange(flags.range, { defaultNamed: "this-month" });
  assertSpan(range.from, range.to);

  const res = await paginateAll<Record<string, unknown>>(`reports/expenses/${axis}`, "results", {
    from: range.from,
    to: range.to,
  });
  const rows = res.items;

  let total = 0;
  let billable = 0;
  const currencies = new Set<string>();
  for (const r of rows) {
    total += typeof r.total_amount === "number" ? r.total_amount : 0;
    billable += typeof r.billable_amount === "number" ? r.billable_amount : 0;
    if (typeof r.currency === "string") currencies.add(r.currency);
  }
  const mixed = currencies.size > 1;
  const currency = currencies.size === 1 ? [...currencies][0] : undefined;

  const header: Record<string, unknown> = {
    range: range.label,
    report: `expenses ${axis}`,
    total_amount: mixed ? "(mixed currencies — not summed)" : `${round2(total)}${currency ? ` ${currency}` : ""}`,
    billable_amount: mixed ? "(mixed currencies — not summed)" : round2(billable),
    rows: rows.length,
    complete: res.complete,
  };
  if (!res.complete) header.capped_at_pages = res.pages_fetched;

  if (rows.length === 0) {
    return joinBlocks(
      renderObject(header),
      renderObject({ expenses: `0 expenses recorded in ${range.label}` }),
      renderHelp(["Broaden the window, or this account may simply have no tracked expenses in range"]),
    );
  }

  const { col, field: nameField } = EXPENSE_ID[axis];
  const schema: FieldDef[] = [{ name: col, extract: (i) => i[nameField] ?? "" }];
  if (axis === "projects") schema.push({ name: "client", extract: (i) => i.client_name ?? "" });
  schema.push(
    { name: "total", extract: (i) => round2(i.total_amount) },
    { name: "billable", extract: (i) => round2(i.billable_amount) },
  );

  const sorted = [...rows].sort(
    (a, b) => (typeof b.total_amount === "number" ? b.total_amount : 0) - (typeof a.total_amount === "number" ? a.total_amount : 0),
  );

  return joinBlocks(
    renderObject(header),
    renderList(`expenses_${axis}`, sorted, schema),
    renderHelp(['Run `harvest-axi reports projects` for tracked-time totals over the same window']),
  );
}

async function budgetReport(flags: ReportsFlags): Promise<string> {
  // Budget is a point-in-time snapshot — it takes NO window. A passed date flag
  // would be silently misapplied, so reject it instead.
  if (hasWindow(flags)) {
    throw new AxiError("`reports budget` is a point-in-time snapshot and takes no window", "VALIDATION_ERROR", [
      "Drop --from/--to/--since/named-window flags",
      "Use `--all` to include inactive projects",
    ]);
  }

  const query: Record<string, QueryValue> = {};
  if (!flags.all) query.is_active = "true";

  const res = await paginateAll<Record<string, unknown>>("reports/project_budget", "results", query);
  const rows = res.items;

  const header: Record<string, unknown> = {
    report: "budget",
    active_only: !flags.all,
    rows: rows.length,
    complete: res.complete,
  };
  if (!res.complete) header.capped_at_pages = res.pages_fetched;

  if (rows.length === 0) {
    return joinBlocks(
      renderObject(header),
      renderObject({ budget: `0 ${flags.all ? "" : "active "}projects with a budget` }),
      renderHelp(["Add `--all` to include inactive projects"]),
    );
  }

  // Most at-risk first: smallest remaining (incl. negative = over budget) on top.
  const sorted = [...rows].sort(
    (a, b) =>
      (typeof a.budget_remaining === "number" ? a.budget_remaining : Infinity) -
      (typeof b.budget_remaining === "number" ? b.budget_remaining : Infinity),
  );

  return joinBlocks(
    renderObject(header),
    renderList("budget", sorted, [
      { name: "project", extract: (i) => i.project_name ?? "" },
      { name: "client", extract: (i) => i.client_name ?? "" },
      { name: "budget_by", extract: (i) => i.budget_by ?? "—" },
      { name: "budget", extract: (i) => round2(i.budget) },
      { name: "spent", extract: (i) => round2(i.budget_spent) },
      { name: "remaining", extract: (i) => round2(i.budget_remaining) },
      { name: "active", extract: (i) => i.is_active },
    ]),
    renderHelp([
      "budget/spent/remaining are in hours OR money per `budget_by`",
      'Run `harvest-axi reports projects` or `review --project "<name>"` for the hours behind a budget',
    ]),
  );
}
