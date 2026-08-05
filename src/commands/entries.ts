import { AxiError } from "axi-sdk-js";
import { readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { whoMe } from "../harvest/identity.js";
import { requireCredentials } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity } from "../harvest/resolve.js";
import { joinBlocks, renderHelp, renderList, renderObject, truncated } from "../output/index.js";
import {
  normalizeArgs,
  rejectInertExportFlag,
  rejectUnknownFlag,
  rejectUnknownPositional,
} from "../cli/args.js";
import { buildExport, parseExportRequest, type ExportRequest } from "../output/export.js";
import { assertUserScope, fetchEntries, type EntryScopeFlags } from "../harvest/entry-query.js";
import { NAMED_WINDOWS } from "../time/ranges.js";

export const ENTRIES_HELP = `usage: harvest-axi entries <subcommand> [args] [flags]
reads:
  list                     batch read: every entry matching a scope + window
  today | yesterday        your entries for that day
  get <id>                 full detail of one entry
list filters (same vocabulary as \`review\`):
  --since <dur> | --from <date> --to <date> | --today --this-week --last-month …
  --team | --user <id|name>   (mutually exclusive)
  --project <id|name>  --client <id|name>  --task <id|name>
  --billable | --non-billable   --unbilled   --approval <status>
  --rounded                display rounded_hours in the hours column
  --limit <n>              cap displayed rows (default 200; exports ignore it)
  --fields <list>          notes, billable, is_billed, approval, client,
                           rounded_hours, billable_rate
writes (default: your own entries; --user <id|name> to act on another):
  log                      create an entry
  edit <id>                update fields on an entry
  delete <id>              remove an entry
  start <id> | stop <id>   restart / stop an entry's timer
log/edit flags:
  --project <id|name>      (required for log)
  --task <id|name>         (required for log)
  --hours <h>              duration-mode entries (omit on log → running timer)
  --started <time> --ended <time>   start/end-mode entries (omit --ended → running)
  --date <YYYY-MM-DD>      default: today
  --notes "<text>"
examples:
  harvest-axi entries list --project "GTFS Pathways" --last-month
  harvest-axi entries today
  harvest-axi entries log --project "GTFS Pathways" --task "T2: Project Management" --hours 1.5 --notes "spec review"
  harvest-axi entries edit 12345 --notes "updated"
  harvest-axi entries stop 12345
`;

interface EntriesFlags {
  project?: string;
  task?: string;
  user?: string;
  hours?: string;
  notes?: string;
  date?: string;
  started?: string;
  ended?: string;
}

/**
 * Per-subcommand flag sets. `entries list` and `entries log` accept different
 * flags, and only the subcommand layer knows which is in play — validating
 * against a merged set would let `entries log --billable` through silently.
 */
const WRITE_FLAGS = [
  "--project",
  "--task",
  "--user",
  "--hours",
  "--notes",
  "--date",
  "--started",
  "--ended",
] as const;

/** `entries list` shares review's filter vocabulary, so the two read alike. */
const LIST_FLAGS = [
  "--from",
  "--to",
  "--since",
  "--team",
  "--user",
  "--project",
  "--client",
  "--task",
  "--billable",
  "--non-billable",
  "--unbilled",
  "--approval",
  "--rounded",
  "--limit",
  "--fields",
  ...NAMED_WINDOWS.map((w) => `--${w}`),
] as const;

const ENTRIES_SUBCOMMAND_FLAGS: Record<string, readonly string[]> = {
  list: LIST_FLAGS,
  today: [],
  yesterday: [],
  get: [],
  log: WRITE_FLAGS,
  edit: WRITE_FLAGS,
  delete: [],
  start: WRITE_FLAGS,
  stop: [],
};

/** Reads that earned machine output — see specs/behaviors/machine-output.md. */
const EXPORTING_SUBCOMMANDS = new Set(["list", "today", "yesterday", "get"]);

const APPROVAL_STATUSES = ["unsubmitted", "submitted", "approved"] as const;

/** Opt-in columns for `entries list --fields`. */
const EXTRA_COLUMNS = [
  "notes",
  "billable",
  "is_billed",
  "approval",
  "client",
  "rounded_hours",
  "billable_rate",
] as const;

interface ListFlags extends EntryScopeFlags {
  rounded: boolean;
  limit: number;
  fields: string[];
}

function parseListFlags(rawArgs: string[]): ListFlags {
  const flags: ListFlags = {
    range: {},
    team: false,
    unbilled: false,
    rounded: false,
    limit: 200,
    fields: [],
  };
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
      case "--team":
        flags.team = true;
        break;
      case "--user":
        flags.user = next;
        i++;
        break;
      case "--project":
        flags.project = next;
        i++;
        break;
      case "--client":
        flags.client = next;
        i++;
        break;
      case "--task":
        flags.task = next;
        i++;
        break;
      case "--billable":
        flags.billable = true;
        break;
      case "--non-billable":
        flags.nonBillable = true;
        break;
      case "--unbilled":
        flags.unbilled = true;
        break;
      case "--approval": {
        if (!APPROVAL_STATUSES.includes(next as (typeof APPROVAL_STATUSES)[number])) {
          throw new AxiError(`Unknown --approval status "${next}"`, "VALIDATION_ERROR", [
            `Valid statuses: ${APPROVAL_STATUSES.join(", ")}`,
          ]);
        }
        flags.approval = next;
        i++;
        break;
      }
      case "--rounded":
        flags.rounded = true;
        break;
      case "--limit":
        flags.limit = Math.max(1, parseInt(next, 10) || 200);
        i++;
        break;
      case "--fields":
        flags.fields = next
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        // Validate here, not while building the schema — an unknown column
        // must not cost an API round trip.
        for (const f of flags.fields) {
          if (!(EXTRA_COLUMNS as readonly string[]).includes(f)) {
            throw new AxiError(`Unknown --fields column "${f}"`, "VALIDATION_ERROR", [
              `Valid columns: ${EXTRA_COLUMNS.join(", ")}`,
            ]);
          }
        }
        i++;
        break;
      default:
        if (arg.startsWith("--") && (NAMED_WINDOWS as readonly string[]).includes(arg.slice(2))) {
          flags.range.named = arg.slice(2);
          break;
        }
        if (arg.startsWith("--"))
          rejectUnknownFlag(arg, LIST_FLAGS, "entries list", { exports: true });
        rejectUnknownPositional(
          arg,
          "entries list",
          "`entries list` takes flags only — run `harvest-axi entries --help` for the list",
        );
    }
  }
  return flags;
}

function parseFlags(
  rawArgs: string[],
  sub: string,
): { flags: EntriesFlags; positionals: string[] } {
  const flags: EntriesFlags = {};
  const positionals: string[] = [];
  const known = ENTRIES_SUBCOMMAND_FLAGS[sub] ?? [];
  const args = normalizeArgs(rawArgs);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--project":
        flags.project = next;
        i++;
        break;
      case "--task":
        flags.task = next;
        i++;
        break;
      case "--user":
        flags.user = next;
        i++;
        break;
      case "--hours":
        flags.hours = next;
        i++;
        break;
      case "--notes":
        flags.notes = next;
        i++;
        break;
      case "--date":
        flags.date = next;
        i++;
        break;
      case "--started":
        flags.started = next;
        i++;
        break;
      case "--ended":
        flags.ended = next;
        i++;
        break;
      default:
        if (!arg.startsWith("--")) {
          positionals.push(arg);
          break;
        }
        rejectUnknownFlag(arg, known, `entries ${sub}`, {
          exports: EXPORTING_SUBCOMMANDS.has(sub),
        });
    }
  }
  return { flags, positionals };
}

function round2(h: number): number {
  return Math.round(h * 100) / 100;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

const nested = (i: Record<string, unknown>, k: string): string =>
  (i[k] as { name?: string } | undefined)?.name ?? "";

/** Normalize a nested Harvest entity to the `{id, name}` the payload spec defines. */
function entityOf(v: unknown): { id: unknown; name: unknown } | null {
  if (!v || typeof v !== "object") return null;
  const e = v as { id?: unknown; name?: unknown };
  return { id: e.id ?? null, name: e.name ?? null };
}

/**
 * The machine payload for one time entry.
 *
 * Carries `hours` **and** `rounded_hours` regardless of `--rounded`: a billing
 * script mirrors how Harvest actually bills, so it needs the rounded figure
 * without re-deriving the account's rounding rule. `--rounded` is a display
 * choice and must not narrow the payload.
 */
function entryPayload(e: Record<string, unknown>): Record<string, unknown> {
  return {
    id: e.id,
    spent_date: e.spent_date,
    user: entityOf(e.user),
    project: entityOf(e.project),
    task: entityOf(e.task),
    client: entityOf(e.client),
    hours: e.hours ?? null,
    rounded_hours: e.rounded_hours ?? null,
    billable: e.billable ?? null,
    is_billed: e.is_billed ?? null,
    is_running: e.is_running ?? null,
    billable_rate: e.billable_rate ?? null,
    cost_rate: e.cost_rate ?? null,
    notes: e.notes ?? null,
  };
}

/**
 * Append the export description to a rendered block, if an export was asked
 * for. Purely additive — the TOON above is untouched.
 */
function withExport(
  rendered: string,
  request: ExportRequest | undefined,
  entries: Record<string, unknown>[],
): string {
  if (!request) return rendered;
  const outcome = buildExport(request, "entries", entries.map(entryPayload));
  return joinBlocks(
    rendered,
    renderObject({ wrote: outcome.wrote, columns: outcome.columns }),
    renderHelp([outcome.helpLine]),
  );
}

/**
 * `entries list` — the batch read.
 *
 * Row-first counterpart to `review`, which answers "what do they add up to".
 * This is the surface a script exports from; see
 * specs/behaviors/machine-output.md for why only one of the two carries the
 * export flags.
 */
async function entriesList(rest: string[], request?: ExportRequest): Promise<string> {
  const flags = parseListFlags(rest);
  assertUserScope(flags, "entries list");
  const creds = requireCredentials();

  const { entries, rangeLabel, scope, complete, pagesFetched } = await fetchEntries(flags, creds);

  const hoursOf = (e: Record<string, unknown>) => num(flags.rounded ? e.rounded_hours : e.hours);
  const total = entries.reduce((sum, e) => sum + hoursOf(e), 0);

  const header: Record<string, unknown> = {
    range: rangeLabel,
    scope,
    total_hours: round2(total),
    entries: entries.length,
    complete,
  };
  if (!complete) header.capped_at_pages = pagesFetched;

  if (entries.length === 0) {
    return withExport(
      joinBlocks(
        renderObject(header),
        renderObject({ entries: `0 entries found in ${rangeLabel} for ${scope}` }),
        renderHelp([
          "Broaden the window with --since / --from / --to",
          "Try --team to widen the scope (manager token required)",
        ]),
      ),
      request,
      entries,
    );
  }

  const capped = entries.length > flags.limit;
  const shown = capped ? entries.slice(0, flags.limit) : entries;

  const schema = [
    { name: "id", extract: (i: Record<string, unknown>) => i.id },
    { name: "spent_date", extract: (i: Record<string, unknown>) => i.spent_date },
    { name: "user", extract: (i: Record<string, unknown>) => nested(i, "user") },
    { name: "project", extract: (i: Record<string, unknown>) => nested(i, "project") },
    { name: "task", extract: (i: Record<string, unknown>) => nested(i, "task") },
    { name: "hours", extract: (i: Record<string, unknown>) => round2(hoursOf(i)) },
  ];
  for (const f of flags.fields) {
    switch (f) {
      case "notes":
        schema.push({ name: "notes", extract: (i) => i.notes ?? "" });
        break;
      case "billable":
        schema.push({ name: "billable", extract: (i) => i.billable });
        break;
      case "is_billed":
        schema.push({ name: "is_billed", extract: (i) => i.is_billed });
        break;
      case "approval":
        schema.push({ name: "approval", extract: (i) => i.approval_status ?? "" });
        break;
      case "client":
        schema.push({ name: "client", extract: (i) => nested(i, "client") });
        break;
      case "rounded_hours":
        schema.push({ name: "rounded_hours", extract: (i) => round2(num(i.rounded_hours)) });
        break;
      case "billable_rate":
        schema.push({ name: "billable_rate", extract: (i) => i.billable_rate ?? "" });
        break;
    }
  }

  const suggestions: string[] = [];
  if (capped) {
    suggestions.push(
      `Showing ${flags.limit} of ${entries.length} matched entries — raise --limit or narrow the window/scope to see the rest`,
    );
  }
  suggestions.push(
    "Run `harvest-axi entries get <id>` for one entry's full detail",
    "Run `harvest-axi review` for rollups over the same window",
  );

  // The export carries every matched entry — `shown` is a display cap only.
  return withExport(
    joinBlocks(renderObject(header), renderList("entries", shown, schema), renderHelp(suggestions)),
    request,
    entries,
  );
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function entriesCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) return ENTRIES_HELP;
  const sub = args[0];
  const rawRest = args.slice(1);
  if (rawRest.includes("--help")) return ENTRIES_HELP;
  // Validate the subcommand before its flags, so `entries bogus --x` reports
  // the unknown subcommand rather than a confusing unknown-flag error.
  if (!(sub in ENTRIES_SUBCOMMAND_FLAGS)) {
    throw new AxiError(`Unknown entries subcommand: ${sub}`, "VALIDATION_ERROR", [
      `Valid subcommands: ${Object.keys(ENTRIES_SUBCOMMAND_FLAGS).join(", ")}`,
      "Run `harvest-axi entries --help` for usage",
    ]);
  }
  // Export flags are global and stripped before the command's own parser; they
  // only *act* on the read subcommands, and are rejected on the writes.
  const { rest, request } = parseExportRequest(rawRest);
  if (request && !EXPORTING_SUBCOMMANDS.has(sub)) {
    rejectInertExportFlag(`--${request.format}-out`, `entries ${sub}`);
  }

  // `list` has its own filter vocabulary, so it parses separately.
  if (sub === "list") return entriesList(rest, request);
  const { flags, positionals } = parseFlags(rest, sub);

  switch (sub) {
    case "today":
      return listDay(todayStr(), "today", request);
    case "yesterday": {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return listDay(ds, "yesterday", request);
    }
    case "get":
      return getEntry(requireId(positionals[0], "get"), request);
    case "log":
      return logEntry(flags);
    case "edit":
      return editEntry(requireId(positionals[0], "edit"), flags);
    case "delete":
      return deleteEntry(requireId(positionals[0], "delete"));
    case "start":
      return startTimer(positionals[0], flags);
    case "stop":
      return stopTimer(requireId(positionals[0], "stop"));
    /* c8 ignore next 2 -- unreachable: sub is validated against the same map above */
    default:
      throw new AxiError(`Unknown entries subcommand: ${sub}`, "VALIDATION_ERROR", []);
  }
}

function requireId(value: string | undefined, sub: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new AxiError(`\`entries ${sub}\` requires a numeric entry id`, "VALIDATION_ERROR", [
      `Run \`harvest-axi entries ${sub} <id>\` (find ids via \`harvest-axi review --by none\`)`,
    ]);
  }
  return Number(value);
}

async function selfUserId(): Promise<number> {
  const cached = readConfig().default_user_id;
  if (cached) return cached;
  return (await whoMe(requireCredentials())).user_id;
}

async function listDay(date: string, label: string, request?: ExportRequest): Promise<string> {
  const userId = await selfUserId();
  const res = await paginateAll<Record<string, unknown>>("time_entries", "time_entries", {
    from: date,
    to: date,
    user_id: userId,
  });

  if (res.items.length === 0) {
    return withExport(
      joinBlocks(
        renderObject({ date: `${date} (${label})` }),
        renderObject({ entries: `0 entries logged on ${date}` }),
        renderHelp([
          'Run `harvest-axi entries log --project "<name>" --task "<name>" --hours <h>` to log time',
        ]),
      ),
      request,
      res.items,
    );
  }

  const total = res.items.reduce((sum, e) => sum + (typeof e.hours === "number" ? e.hours : 0), 0);
  return withExport(
    joinBlocks(
      renderObject({
        date: `${date} (${label})`,
        entries: res.items.length,
        total_hours: Math.round(total * 100) / 100,
      }),
      renderList("entries", res.items, [
        { name: "id", extract: (i) => i.id },
        { name: "project", extract: (i) => (i.project as { name?: string })?.name ?? "" },
        { name: "task", extract: (i) => (i.task as { name?: string })?.name ?? "" },
        { name: "hours", extract: (i) => i.hours },
        truncated("notes", 50),
        { name: "running", extract: (i) => i.is_running },
      ]),
      renderHelp([
        "Run `harvest-axi entries get <id>` for full detail, or `entries log ...` to add time",
      ]),
    ),
    request,
    res.items,
  );
}

async function getEntry(id: number, request?: ExportRequest): Promise<string> {
  const e = await harvestRequest<Record<string, unknown>>(`time_entries/${id}`);
  const nested = (k: string) => (e[k] as { name?: string } | undefined)?.name ?? "";
  // Self-contained detail view — full notes, no truncation, no suggestions.
  const detail = renderObject({
    id: e.id,
    spent_date: e.spent_date,
    user: (e.user as { name?: string })?.name ?? "",
    client: nested("client"),
    project: nested("project"),
    task: nested("task"),
    hours: e.hours,
    rounded_hours: e.rounded_hours,
    billable: e.billable,
    is_billed: e.is_billed,
    approval_status: e.approval_status,
    is_running: e.is_running,
    started_time: e.started_time ?? "",
    ended_time: e.ended_time ?? "",
    notes: e.notes ?? "",
  });
  // A single record still exports as a one-element `entries` array, so the
  // same `jq` idiom works here as on the batch surfaces.
  return withExport(detail, request, [e]);
}

/** Returns the account's timer mode, or undefined when not cached (lenient). */
function timerMode(): "duration" | "start_end" | undefined {
  const w = readConfig().profile_cache?.wants_timestamp_timers;
  if (w === undefined) return undefined;
  return w ? "start_end" : "duration";
}

async function buildWriteBody(
  flags: EntriesFlags,
  forCreate: boolean,
): Promise<Record<string, unknown>> {
  // Mode enforcement (deferred from auth-identity): reject the wrong mode's
  // flags up front, before any name-resolution lookup.
  const mode = timerMode();
  if (mode === "duration" && (flags.started || flags.ended)) {
    throw new AxiError(
      "This account tracks time in duration mode — use --hours, not --started/--ended",
      "VALIDATION_ERROR",
      ['Example: entries log --project "<name>" --task "<name>" --hours 1.5'],
    );
  }
  if (mode === "start_end" && flags.hours !== undefined) {
    throw new AxiError(
      "This account tracks time in start/end mode — use --started/--ended, not --hours",
      "VALIDATION_ERROR",
      ['Example: entries log --project "<name>" --task "<name>" --started 9:00am --ended 10:30am'],
    );
  }

  const body: Record<string, unknown> = {};
  if (flags.project) body.project_id = (await resolveEntity("project", flags.project)).id;
  if (flags.task) body.task_id = (await resolveEntity("task", flags.task)).id;
  if (flags.user) body.user_id = (await resolveEntity("user", flags.user)).id;
  if (flags.notes !== undefined) body.notes = flags.notes;
  if (flags.date) body.spent_date = flags.date;

  if (flags.hours !== undefined) {
    const h = Number(flags.hours);
    if (Number.isNaN(h))
      throw new AxiError(`--hours must be a number, got "${flags.hours}"`, "VALIDATION_ERROR", []);
    body.hours = h;
  }
  if (flags.started) body.started_time = flags.started;
  if (flags.ended) body.ended_time = flags.ended;

  if (forCreate && !body.spent_date) body.spent_date = todayStr();
  return body;
}

async function logEntry(flags: EntriesFlags): Promise<string> {
  if (!flags.project || !flags.task) {
    throw new AxiError("`entries log` requires --project and --task", "VALIDATION_ERROR", [
      "Run `harvest-axi browse mine` to see your assignable projects and their tasks",
    ]);
  }
  const body = await buildWriteBody(flags, true);
  const created = await harvestRequest<Record<string, unknown>>("time_entries", {
    method: "POST",
    body,
  });
  return renderObject({
    status: "logged",
    id: created.id,
    spent_date: created.spent_date,
    project: (created.project as { name?: string })?.name ?? "",
    task: (created.task as { name?: string })?.name ?? "",
    hours: created.hours,
    running: created.is_running,
  });
}

async function editEntry(id: number, flags: EntriesFlags): Promise<string> {
  const body = await buildWriteBody(flags, false);
  if (Object.keys(body).length === 0) {
    throw new AxiError("`entries edit` needs at least one field to change", "VALIDATION_ERROR", [
      "e.g. --notes, --hours, --project, --task, --date",
    ]);
  }
  const updated = await harvestRequest<Record<string, unknown>>(`time_entries/${id}`, {
    method: "PATCH",
    body,
  });
  return renderObject({
    status: "updated",
    id: updated.id,
    spent_date: updated.spent_date,
    hours: updated.hours,
    notes: updated.notes ?? "",
  });
}

async function deleteEntry(id: number): Promise<string> {
  try {
    await harvestRequest(`time_entries/${id}`, { method: "DELETE" });
    return renderObject({ status: "deleted", id });
  } catch (err) {
    // Idempotent: an already-absent entry is a no-op, not an error.
    if (err instanceof AxiError && err.code === "NOT_FOUND") {
      return renderObject({ status: `entry ${id} not found (no-op)`, id });
    }
    throw err;
  }
}

async function startTimer(idArg: string | undefined, flags: EntriesFlags): Promise<string> {
  // `start` with no id but project/task → create a fresh running entry.
  if (!idArg && (flags.project || flags.task)) {
    return logEntry({ ...flags, hours: undefined, started: undefined, ended: undefined });
  }
  const id = requireId(idArg, "start");
  const current = await harvestRequest<Record<string, unknown>>(`time_entries/${id}`);
  if (current.is_running === true)
    return renderObject({ status: `entry ${id} already running (no-op)`, id });
  const started = await harvestRequest<Record<string, unknown>>(`time_entries/${id}/restart`, {
    method: "PATCH",
  });
  return renderObject({ status: "started", id, running: started.is_running });
}

async function stopTimer(id: number): Promise<string> {
  const current = await harvestRequest<Record<string, unknown>>(`time_entries/${id}`);
  if (current.is_running !== true)
    return renderObject({ status: `entry ${id} already stopped (no-op)`, id });
  const stopped = await harvestRequest<Record<string, unknown>>(`time_entries/${id}/stop`, {
    method: "PATCH",
  });
  return renderObject({ status: "stopped", id, hours: stopped.hours });
}
