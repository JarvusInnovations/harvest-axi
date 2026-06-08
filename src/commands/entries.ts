import { AxiError } from "axi-sdk-js";
import { readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { whoMe } from "../harvest/identity.js";
import { requireCredentials } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity } from "../harvest/resolve.js";
import { joinBlocks, renderHelp, renderList, renderObject, truncated } from "../output/index.js";

export const ENTRIES_HELP = `usage: harvest-axi entries <subcommand> [args] [flags]
reads:
  today | yesterday        your entries for that day
  get <id>                 full detail of one entry
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

function parseFlags(args: string[]): { flags: EntriesFlags; positionals: string[] } {
  const flags: EntriesFlags = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--project": flags.project = next; i++; break;
      case "--task": flags.task = next; i++; break;
      case "--user": flags.user = next; i++; break;
      case "--hours": flags.hours = next; i++; break;
      case "--notes": flags.notes = next; i++; break;
      case "--date": flags.date = next; i++; break;
      case "--started": flags.started = next; i++; break;
      case "--ended": flags.ended = next; i++; break;
      default:
        if (!arg.startsWith("--")) positionals.push(arg);
        break;
    }
  }
  return { flags, positionals };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function entriesCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) return ENTRIES_HELP;
  const sub = args[0];
  const rest = args.slice(1);
  if (rest.includes("--help")) return ENTRIES_HELP;
  const { flags, positionals } = parseFlags(rest);

  switch (sub) {
    case "today": return listDay(todayStr(), "today");
    case "yesterday": {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return listDay(ds, "yesterday");
    }
    case "get": return getEntry(requireId(positionals[0], "get"));
    case "log": return logEntry(flags);
    case "edit": return editEntry(requireId(positionals[0], "edit"), flags);
    case "delete": return deleteEntry(requireId(positionals[0], "delete"));
    case "start": return startTimer(positionals[0], flags);
    case "stop": return stopTimer(requireId(positionals[0], "stop"));
    default:
      throw new AxiError(`Unknown entries subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `harvest-axi entries --help` to see available subcommands",
      ]);
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

async function listDay(date: string, label: string): Promise<string> {
  const userId = await selfUserId();
  const res = await paginateAll<Record<string, unknown>>("time_entries", "time_entries", {
    from: date,
    to: date,
    user_id: userId,
  });

  if (res.items.length === 0) {
    return joinBlocks(
      renderObject({ date: `${date} (${label})` }),
      renderObject({ entries: `0 entries logged on ${date}` }),
      renderHelp(['Run `harvest-axi entries log --project "<name>" --task "<name>" --hours <h>` to log time']),
    );
  }

  const total = res.items.reduce((sum, e) => sum + (typeof e.hours === "number" ? e.hours : 0), 0);
  return joinBlocks(
    renderObject({ date: `${date} (${label})`, entries: res.items.length, total_hours: Math.round(total * 100) / 100 }),
    renderList("entries", res.items, [
      { name: "id", extract: (i) => i.id },
      { name: "project", extract: (i) => (i.project as { name?: string })?.name ?? "" },
      { name: "task", extract: (i) => (i.task as { name?: string })?.name ?? "" },
      { name: "hours", extract: (i) => i.hours },
      truncated("notes", 50),
      { name: "running", extract: (i) => i.is_running },
    ]),
    renderHelp(["Run `harvest-axi entries get <id>` for full detail, or `entries log ...` to add time"]),
  );
}

async function getEntry(id: number): Promise<string> {
  const e = await harvestRequest<Record<string, unknown>>(`time_entries/${id}`);
  const nested = (k: string) => (e[k] as { name?: string } | undefined)?.name ?? "";
  // Self-contained detail view — full notes, no truncation, no suggestions.
  return renderObject({
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
}

/** Returns the account's timer mode, or undefined when not cached (lenient). */
function timerMode(): "duration" | "start_end" | undefined {
  const w = readConfig().profile_cache?.wants_timestamp_timers;
  if (w === undefined) return undefined;
  return w ? "start_end" : "duration";
}

async function buildWriteBody(flags: EntriesFlags, forCreate: boolean): Promise<Record<string, unknown>> {
  // Mode enforcement (deferred from auth-identity): reject the wrong mode's
  // flags up front, before any name-resolution lookup.
  const mode = timerMode();
  if (mode === "duration" && (flags.started || flags.ended)) {
    throw new AxiError("This account tracks time in duration mode — use --hours, not --started/--ended", "VALIDATION_ERROR", [
      'Example: entries log --project "<name>" --task "<name>" --hours 1.5',
    ]);
  }
  if (mode === "start_end" && flags.hours !== undefined) {
    throw new AxiError("This account tracks time in start/end mode — use --started/--ended, not --hours", "VALIDATION_ERROR", [
      'Example: entries log --project "<name>" --task "<name>" --started 9:00am --ended 10:30am',
    ]);
  }

  const body: Record<string, unknown> = {};
  if (flags.project) body.project_id = (await resolveEntity("project", flags.project)).id;
  if (flags.task) body.task_id = (await resolveEntity("task", flags.task)).id;
  if (flags.user) body.user_id = (await resolveEntity("user", flags.user)).id;
  if (flags.notes !== undefined) body.notes = flags.notes;
  if (flags.date) body.spent_date = flags.date;

  if (flags.hours !== undefined) {
    const h = Number(flags.hours);
    if (Number.isNaN(h)) throw new AxiError(`--hours must be a number, got "${flags.hours}"`, "VALIDATION_ERROR", []);
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
  const created = await harvestRequest<Record<string, unknown>>("time_entries", { method: "POST", body });
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
  const updated = await harvestRequest<Record<string, unknown>>(`time_entries/${id}`, { method: "PATCH", body });
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
  if (current.is_running === true) return renderObject({ status: `entry ${id} already running (no-op)`, id });
  const started = await harvestRequest<Record<string, unknown>>(`time_entries/${id}/restart`, { method: "PATCH" });
  return renderObject({ status: "started", id, running: started.is_running });
}

async function stopTimer(id: number): Promise<string> {
  const current = await harvestRequest<Record<string, unknown>>(`time_entries/${id}`);
  if (current.is_running !== true) return renderObject({ status: `entry ${id} already stopped (no-op)`, id });
  const stopped = await harvestRequest<Record<string, unknown>>(`time_entries/${id}/stop`, { method: "PATCH" });
  return renderObject({ status: "stopped", id, hours: stopped.hours });
}
