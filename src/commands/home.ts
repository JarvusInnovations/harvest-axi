import { isConfigured, readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";

/**
 * No-args home view (also the SessionStart hook payload). Per "content first":
 * identity + recency signals (active timer, today, last entry, recent 3) +
 * review-leaning suggestions. Token-budget discipline: ONE live API call (the
 * user's 50 newest entries), from which every live field is derived.
 *
 * Returns a pre-composed string (not an object) so the help block renders
 * multi-line — the canonical AXI form (chrome-devtools-axi / slack-axi). The SDK
 * prepends the bin/description header to a string home result.
 */
export async function homeCommand(): Promise<string> {
  if (!isConfigured()) {
    return joinBlocks(
      renderObject({ setup: "no Harvest credentials configured" }),
      renderHelp([
        "Run `harvest-axi auth setup --token <pat> --account <id>` to connect your Harvest account",
        "Create a Personal Access Token at https://id.getharvest.com/developers",
      ]),
    );
  }

  const cfg = readConfig();
  const fields: Record<string, unknown> = {};
  if (cfg.profile_cache) {
    fields.account = cfg.profile_cache.account_name;
    fields.user = cfg.profile_cache.user_name;
  }

  // ONE API call → active_timer?/today/last_entry fields + the recent table.
  const recent = await applyRecency(fields, cfg.default_user_id);

  const help = renderHelp([
    "Run `harvest-axi review --since 7d` to review your last week",
    "Run `harvest-axi review --team --this-week` to review the whole team",
    "Run `harvest-axi entries today` to see today's entries, or `start`/`stop` a timer",
    "Run `harvest-axi --help` to see the full command list, or `harvest-axi <command> --help` for usage on any command",
  ]);

  return joinBlocks(renderObject(fields), recent, help);
}

function round2(h: number): number {
  return Math.round(h * 100) / 100;
}

function hoursOf(e: Record<string, unknown>): number {
  return typeof e.hours === "number" ? e.hours : 0;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoLabel(spentDate: string): string {
  const [y, m, d] = spentDate.split("-").map(Number);
  if (!y || !m || !d) return spentDate;
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return `${spentDate} (today)`;
  if (days === 1) return `${spentDate} (yesterday)`;
  return `${spentDate} (${days} days ago)`;
}

function projTask(e: Record<string, unknown>): string {
  const p = (e.project as { name?: string })?.name ?? "?";
  const t = (e.task as { name?: string })?.name ?? "?";
  return `${p} / ${t}`;
}

/**
 * One API call → set active_timer?/today/last_entry on `fields` and return the
 * rendered `recent` table (or "" when none / on failure, so the home view still
 * shows identity + suggestions).
 */
async function applyRecency(
  fields: Record<string, unknown>,
  userId: number | undefined,
): Promise<string> {
  if (!userId) return "";
  let entries: Array<Record<string, unknown>>;
  try {
    const res = await harvestRequest<{ time_entries?: Array<Record<string, unknown>> }>(
      "time_entries",
      { query: { user_id: userId, per_page: 50 } },
    );
    entries = res.time_entries ?? [];
  } catch {
    return "";
  }

  if (entries.length === 0) {
    fields.today = "nothing logged yet";
    return "";
  }

  const running = entries.find((e) => e.is_running === true);
  if (running) {
    fields.active_timer = `${projTask(running)} — ${round2(hoursOf(running))}h elapsed`;
  }

  const today = todayStr();
  const todays = entries.filter((e) => e.spent_date === today);
  fields.today =
    todays.length > 0
      ? `${round2(todays.reduce((s, e) => s + hoursOf(e), 0))}h across ${todays.length} ${todays.length === 1 ? "entry" : "entries"}`
      : "nothing logged yet";

  fields.last_entry = daysAgoLabel(String(entries[0].spent_date ?? ""));

  return renderList(
    "recent",
    entries.slice(0, 3),
    [
      { name: "spent_date", extract: (i) => i.spent_date },
      { name: "project", extract: (i) => (i.project as { name?: string })?.name ?? "" },
      { name: "task", extract: (i) => (i.task as { name?: string })?.name ?? "" },
      { name: "hours", extract: (i) => i.hours },
    ],
  );
}
