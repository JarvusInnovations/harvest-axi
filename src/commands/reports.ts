import { AxiError } from "axi-sdk-js";
import type { QueryValue } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { joinBlocks, renderHelp, renderList, renderObject, type FieldDef } from "../output/index.js";
import { parseRange, type RangeFlags, NAMED_WINDOWS } from "../time/ranges.js";

export const REPORTS_HELP = `usage: harvest-axi reports <axis> [window] [flags]
axes[4]:
  clients | projects | tasks | team
time window (see date-ranges; default: this-month, max span 365 days):
  --since <dur>        7d | 2w | 1m
  --from <date> --to <date>
  --today --yesterday --this-week --last-week --this-month --last-month
flags:
  --fixed-fee          include billable amounts for fixed-fee projects
examples:
  harvest-axi reports projects --this-month
  harvest-axi reports clients --from 2026-01-01 --to 2026-03-31
  harvest-axi reports team --last-month
note:
  reports = server-aggregated totals + billable $ over a window. For per-entry
  detail or flexible grouping, use \`harvest-axi review\`.
`;

type Axis = "clients" | "projects" | "tasks" | "team";
const AXES: Axis[] = ["clients", "projects", "tasks", "team"];

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
}

function parseReportsFlags(args: string[]): ReportsFlags {
  const flags: ReportsFlags = { range: {}, fixedFee: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--from": flags.range.from = next; i++; break;
      case "--to": flags.range.to = next; i++; break;
      case "--since": flags.range.since = next; i++; break;
      case "--fixed-fee": flags.fixedFee = true; break;
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

export async function reportsCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) return REPORTS_HELP;
  const axis = args[0] as Axis;
  if (!AXES.includes(axis)) {
    throw new AxiError(`Unknown reports axis: ${args[0]}`, "VALIDATION_ERROR", [
      `Valid axes: ${AXES.join(", ")}`,
    ]);
  }
  const rest = args.slice(1);
  if (rest.includes("--help")) return REPORTS_HELP;
  const flags = parseReportsFlags(rest);

  const range = parseRange(flags.range, { defaultNamed: "this-month" });
  if (daySpan(range.from, range.to) > 365) {
    throw new AxiError(
      `Reports span ${range.from} → ${range.to} exceeds the 365-day maximum`,
      "VALIDATION_ERROR",
      ["Narrow the window (e.g. --this-month, --from/--to within a year)"],
    );
  }

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
