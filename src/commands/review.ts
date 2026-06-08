import { AxiError } from "axi-sdk-js";
import { readConfig, type Credentials } from "../config.js";
import { requireCredentials } from "../harvest/client.js";
import { whoMe } from "../harvest/identity.js";
import { paginateAll } from "../harvest/paginate.js";
import type { QueryValue } from "../harvest/client.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";
import { parseRange, type RangeFlags, NAMED_WINDOWS } from "../time/ranges.js";

export const REVIEW_HELP = `usage: harvest-axi review [scope] [window] [--by <axis>] [flags]
time window (default: last 7d for you, this-week for --team):
  --since <dur>        7d | 2w | 1m
  --from <date> --to <date>
  --today --yesterday --this-week --last-week --this-month --last-month
scope (default: your own entries):
  --team               all users your token can see
  --user <id>          a specific user (names land with the browse plan)
  --project <id>       one project
  --client <id>        one client
  --task <id>          one task
refine:
  --billable | --non-billable
  --unbilled           uninvoiced entries only
  --approval <status>  unsubmitted | submitted | approved
grouping & detail:
  --by <axis>          user | project | client | task | day | none
  --rounded            use rounded_hours instead of hours
  --limit <n>          cap raw rows under --by none (default 200)
  --fields <list>      extra --by-none columns: notes, billable, approval, client
examples:
  harvest-axi review                          # your last 7 days, by day
  harvest-axi review --team --this-week       # everyone this week, by user
  harvest-axi review --client 123 --last-month --by project
  harvest-axi review --project 456 --by task --unbilled
`;

type Axis = "user" | "project" | "client" | "task" | "day" | "none";
const AXES: Axis[] = ["user", "project", "client", "task", "day", "none"];

interface ReviewFlags {
  range: RangeFlags;
  team: boolean;
  user?: string;
  project?: string;
  client?: string;
  task?: string;
  billable?: boolean;
  nonBillable?: boolean;
  unbilled: boolean;
  approval?: string;
  by?: Axis;
  rounded: boolean;
  limit: number;
  fields: string[];
}

/** A numeric scope value passes through as an id; a name is deferred to browse. */
function scopeId(flag: string, value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  throw new AxiError(
    `Scope by name ("${value}") isn't available yet — pass a numeric id to ${flag}`,
    "VALIDATION_ERROR",
    [
      "Name resolution lands with the `browse` plan (clients/projects/tasks/users + a name→id cache)",
      `For now: find the id via the Harvest UI or pass ${flag} <id>`,
    ],
  );
}

function parseReviewFlags(args: string[]): ReviewFlags {
  const flags: ReviewFlags = {
    range: {},
    team: false,
    unbilled: false,
    rounded: false,
    limit: 200,
    fields: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--from": flags.range.from = next; i++; break;
      case "--to": flags.range.to = next; i++; break;
      case "--since": flags.range.since = next; i++; break;
      case "--team":
      case "--all-users": flags.team = true; break;
      case "--user": flags.user = next; i++; break;
      case "--project": flags.project = next; i++; break;
      case "--client": flags.client = next; i++; break;
      case "--task": flags.task = next; i++; break;
      case "--billable": flags.billable = true; break;
      case "--non-billable": flags.nonBillable = true; break;
      case "--unbilled": flags.unbilled = true; break;
      case "--approval": flags.approval = next; i++; break;
      case "--rounded": flags.rounded = true; break;
      case "--limit": flags.limit = Math.max(1, parseInt(next, 10) || 200); i++; break;
      case "--fields":
        flags.fields = next.split(",").map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case "--by": {
        if (!AXES.includes(next as Axis)) {
          throw new AxiError(`Unknown --by axis "${next}"`, "VALIDATION_ERROR", [
            `Valid axes: ${AXES.join(", ")}`,
          ]);
        }
        flags.by = next as Axis;
        i++;
        break;
      }
      default:
        // Named window flags (--today, --this-week, ...).
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

/** Round hours to 2 decimals as a number, so TOON renders it bare (no quotes). */
function round2(h: number): number {
  return Math.round(h * 100) / 100;
}

/** Pick the default grouping axis from the active scope. */
function defaultAxis(flags: ReviewFlags): Axis {
  if (flags.project) return "task";
  if (flags.client) return "project";
  if (flags.team) return "user";
  return "day";
}

function groupKey(entry: Record<string, unknown>, axis: Axis): string {
  const nested = (k: string) =>
    ((entry[k] as { name?: string } | undefined)?.name ?? "—");
  switch (axis) {
    case "user": return nested("user");
    case "project": return nested("project");
    case "client": return nested("client");
    case "task": return nested("task");
    case "day": return String(entry.spent_date ?? "—");
    default: return "—";
  }
}

async function resolveSelfUserId(creds: Credentials): Promise<number> {
  const cached = readConfig().default_user_id;
  if (cached) return cached;
  return (await whoMe(creds)).user_id;
}

export async function reviewCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return REVIEW_HELP;
  const flags = parseReviewFlags(args);
  const creds = requireCredentials();

  // Window: default depends on scope.
  const range = parseRange(
    flags.range,
    flags.team ? { defaultNamed: "this-week" } : { defaultSince: "7d" },
  );

  // Resolve scope ids up front (synchronous) so a name-based scope fails fast,
  // before any network call.
  const query: Record<string, QueryValue> = { from: range.from, to: range.to };
  const userId = flags.user ? scopeId("--user", flags.user) : undefined;
  if (flags.project) query.project_id = scopeId("--project", flags.project);
  if (flags.client) query.client_id = scopeId("--client", flags.client);
  if (flags.task) query.task_id = scopeId("--task", flags.task);

  const scopeParts: string[] = [];
  if (flags.team) {
    scopeParts.push("team");
  } else if (userId !== undefined) {
    query.user_id = userId;
    scopeParts.push(`user #${userId}`);
  } else {
    query.user_id = await resolveSelfUserId(creds);
    scopeParts.push("you");
  }
  if (query.project_id) scopeParts.push(`project #${query.project_id}`);
  if (query.client_id) scopeParts.push(`client #${query.client_id}`);
  if (query.task_id) scopeParts.push(`task #${query.task_id}`);

  // Refinements: billable is client-side (Harvest's is_billed = invoiced, not billable);
  // unbilled/approval map to server filters.
  if (flags.unbilled) query.is_billed = false;
  if (flags.approval) query.approval_status = flags.approval;

  const result = await paginateAll<Record<string, unknown>>("time_entries", "time_entries", query);
  let entries = result.items;

  // Billable filter is client-side (Harvest's is_billed ≠ billable).
  if (flags.billable) entries = entries.filter((e) => e.billable === true);
  if (flags.nonBillable) entries = entries.filter((e) => e.billable === false);

  const hoursOf = (e: Record<string, unknown>) =>
    num(flags.rounded ? e.rounded_hours : e.hours);

  // Totals (always present — the answer before any grouping).
  let total = 0;
  let billableTotal = 0;
  let running = 0;
  for (const e of entries) {
    const h = hoursOf(e);
    total += h;
    if (e.billable === true) billableTotal += h;
    if (e.is_running === true) running++;
  }
  const nonBillable = total - billableTotal;

  // `complete` reflects pagination only — a client-side --billable filter
  // legitimately reduces the row count without meaning the read was partial.
  const header: Record<string, unknown> = {
    range: range.label,
    scope: scopeParts.join(" · "),
    total_hours: round2(total),
    billable_hours: round2(billableTotal),
    non_billable_hours: round2(nonBillable),
    entries: entries.length,
    complete: result.complete,
  };
  if (!result.complete) header.capped_at_pages = result.pages_fetched;

  // --team visibility disclosure: token saw only one user despite asking for all.
  if (flags.team) {
    const distinct = new Set(entries.map((e) => (e.user as { id?: number } | undefined)?.id));
    if (distinct.size <= 1 && entries.length > 0) {
      header.note = "your token returned only one user's entries — a manager/admin role is required for team-wide data";
    }
  }
  if (running > 0) header.running = `${running} timer${running === 1 ? "" : "s"} running (hours reflect elapsed-so-far)`;

  const axis: Axis = flags.by ?? defaultAxis(flags);

  // Empty state — definitive.
  if (entries.length === 0) {
    return joinBlocks(
      renderObject(header),
      renderObject({ entries: `0 entries found in ${range.label} for ${scopeParts.join(" · ")}` }),
      renderHelp([
        "Broaden the window with --since / --from / --to",
        flags.billable || flags.nonBillable || flags.unbilled || flags.approval
          ? "Drop the --billable/--unbilled/--approval refinements"
          : "Try --team to widen the scope (manager token required)",
      ]),
    );
  }

  if (axis === "none") return renderRaw(header, entries, flags, range.label, result.total_entries);
  return renderRollup(header, entries, axis, hoursOf);
}

function renderRollup(
  header: Record<string, unknown>,
  entries: Record<string, unknown>[],
  axis: Axis,
  hoursOf: (e: Record<string, unknown>) => number,
): string {
  const groups = new Map<string, { hours: number; billable: number; entries: number }>();
  for (const e of entries) {
    const key = groupKey(e, axis);
    const g = groups.get(key) ?? { hours: 0, billable: 0, entries: 0 };
    const h = hoursOf(e);
    g.hours += h;
    if (e.billable === true) g.billable += h;
    g.entries += 1;
    groups.set(key, g);
  }

  const rows = [...groups.entries()]
    .map(([key, g]) => ({
      [axis]: key,
      hours: round2(g.hours),
      billable: round2(g.billable),
      entries: g.entries,
    }))
    .sort((a, b) => (b.hours as number) - (a.hours as number));

  const suggestions = [
    `Run \`harvest-axi review --by ${axis === "project" ? "task" : "project"}\` to regroup`,
    "Run `harvest-axi review --by none` to see the raw entries",
  ];

  return joinBlocks(
    renderObject(header),
    renderList(`by_${axis}`, rows as unknown as Record<string, unknown>[], [
      { name: axis, extract: (i) => i[axis] },
      { name: "hours", extract: (i) => i.hours },
      { name: "billable", extract: (i) => i.billable },
      { name: "entries", extract: (i) => i.entries },
    ]),
    renderHelp(suggestions),
  );
}

function renderRaw(
  header: Record<string, unknown>,
  entries: Record<string, unknown>[],
  flags: ReviewFlags,
  rangeLabel: string,
  totalEntries: number,
): string {
  const capped = entries.length > flags.limit;
  const shown = capped ? entries.slice(0, flags.limit) : entries;

  const schema = [
    { name: "id", extract: (i: Record<string, unknown>) => i.id },
    { name: "spent_date", extract: (i: Record<string, unknown>) => i.spent_date },
    { name: "user", extract: (i: Record<string, unknown>) => (i.user as { name?: string })?.name ?? "" },
    { name: "project", extract: (i: Record<string, unknown>) => (i.project as { name?: string })?.name ?? "" },
    { name: "task", extract: (i: Record<string, unknown>) => (i.task as { name?: string })?.name ?? "" },
    { name: "hours", extract: (i: Record<string, unknown>) => round2(num(flags.rounded ? i.rounded_hours : i.hours)) },
  ];
  for (const f of flags.fields) {
    switch (f) {
      case "notes": schema.push({ name: "notes", extract: (i) => i.notes ?? "" }); break;
      case "billable": schema.push({ name: "billable", extract: (i) => i.billable }); break;
      case "approval": schema.push({ name: "approval", extract: (i) => i.approval_status ?? "" }); break;
      case "client": schema.push({ name: "client", extract: (i) => (i.client as { name?: string })?.name ?? "" }); break;
    }
  }

  const suggestions: string[] = ["Run `harvest-axi entries get <id>` for one entry's full detail"];
  if (capped) {
    suggestions.unshift(
      `Showing ${flags.limit} of ${entries.length} matched entries — raise --limit or narrow the window/scope to see the rest`,
    );
  }

  return joinBlocks(
    renderObject(header),
    renderList("entries", shown, schema),
    renderHelp(suggestions),
  );
}
