/**
 * The shared time-entry query path.
 *
 * `review` (rollups) and `entries list` (batch rows) answer different questions
 * about the same data, so they must resolve scope and window *identically*. Two
 * divergent copies of this logic is how #14-class bugs multiply, so both
 * commands call through here rather than each building a query.
 */
import { rejectContradiction } from "../cli/args.js";
import { readConfig, type Credentials } from "../config.js";
import type { QueryValue } from "./client.js";
import { whoMe } from "./identity.js";
import { paginateAll } from "./paginate.js";
import { resolveEntity } from "./resolve.js";
import { parseRange, type RangeFlags } from "../time/ranges.js";

export interface EntryScopeFlags {
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
}

export interface EntryQueryResult {
  entries: Record<string, unknown>[];
  /** Resolved, year-stamped window — echoed in every header. */
  rangeLabel: string;
  /** Human scope description (`team`, `user Jane`, `you · project Acme`). */
  scope: string;
  complete: boolean;
  pagesFetched: number;
}

/**
 * `--team` ("all users") and `--user` ("this one") contradict each other.
 *
 * Letting `--team` win silently returned whole-team totals under a single-user
 * label (#14) — plausible-looking output nothing downstream could detect as
 * wrong. Rejected before any resolve call, so the bad pair costs no round trip.
 * Shared so `review` and `entries list` can't drift on it.
 */
export function assertUserScope(flags: { team: boolean; user?: string }, command: string): void {
  if (flags.team && flags.user !== undefined) {
    rejectContradiction("--team", "--user", command, [
      "Use `--user <id|name>` alone to scope to one user",
      "Use `--team --by user` for a per-user breakdown of the whole team",
    ]);
  }
}

async function resolveSelfUserId(creds: Credentials): Promise<number> {
  const cached = readConfig().default_user_id;
  if (cached) return cached;
  return (await whoMe(creds)).user_id;
}

/**
 * Resolve the window and scope, fetch every matching entry, and apply the
 * client-side refinements.
 *
 * `--billable` is filtered client-side because Harvest's `is_billed` means
 * *invoiced*, not *billable*; `--unbilled` and `--approval` are real server
 * filters.
 */
export async function fetchEntries(
  flags: EntryScopeFlags,
  creds: Credentials,
): Promise<EntryQueryResult> {
  // Window default depends on scope: a team sweep defaults to this week, a
  // personal one to the last 7 days.
  const range = parseRange(
    flags.range,
    flags.team ? { defaultNamed: "this-week" } : { defaultSince: "7d" },
  );

  const query: Record<string, QueryValue> = { from: range.from, to: range.to };
  const scopeParts: string[] = [];

  // Resolve names → ids before any fetch (fail fast on a bad reference).
  const user = flags.user ? await resolveEntity("user", flags.user) : undefined;
  const project = flags.project ? await resolveEntity("project", flags.project) : undefined;
  const client = flags.client ? await resolveEntity("client", flags.client) : undefined;
  const task = flags.task ? await resolveEntity("task", flags.task) : undefined;

  // Exactly one user scope applies; callers reject --team + --user upstream.
  if (flags.team) {
    scopeParts.push("team");
  } else if (user) {
    query.user_id = user.id;
    scopeParts.push(`user ${user.name}`);
  } else {
    query.user_id = await resolveSelfUserId(creds);
    scopeParts.push("you");
  }
  if (project) {
    query.project_id = project.id;
    scopeParts.push(`project ${project.name}`);
  }
  if (client) {
    query.client_id = client.id;
    scopeParts.push(`client ${client.name}`);
  }
  if (task) {
    query.task_id = task.id;
    scopeParts.push(`task ${task.name}`);
  }

  if (flags.unbilled) query.is_billed = false;
  if (flags.approval) query.approval_status = flags.approval;

  const result = await paginateAll<Record<string, unknown>>("time_entries", "time_entries", query);
  let entries = result.items;

  if (flags.billable) entries = entries.filter((e) => e.billable === true);
  if (flags.nonBillable) entries = entries.filter((e) => e.billable === false);

  return {
    entries,
    rangeLabel: range.label,
    scope: scopeParts.join(" · "),
    complete: result.complete,
    pagesFetched: result.pages_fetched,
  };
}
