import { isConfigured, readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";

/**
 * No-args home view (also the SessionStart hook payload). Per "content first":
 * identity + recency signals (active timer, today, last entry, recent 3) +
 * review-leaning suggestions. Token-budget discipline: ONE live API call (the
 * user's 50 newest entries), from which every live field is derived; the live
 * block degrades gracefully on failure. Returns a plain object — the SDK merges
 * the bin/description header and TOON-encodes it (the `recent` array → a table).
 */
export async function homeCommand(): Promise<Record<string, unknown>> {
  if (!isConfigured()) {
    return {
      setup: "no Harvest credentials configured",
      help: [
        "Run `harvest-axi auth setup --token <pat> --account <id>` to connect your Harvest account",
        "Create a Personal Access Token at https://id.getharvest.com/developers",
      ],
    };
  }

  const cfg = readConfig();
  const output: Record<string, unknown> = {};
  if (cfg.profile_cache) {
    output.account = cfg.profile_cache.account_name;
    output.user = cfg.profile_cache.user_name;
  }

  // Live recency block (insertion order = output order).
  await applyRecency(output, cfg.default_user_id);

  output.help = [
    "Run `harvest-axi review --since 7d` to review your last week",
    "Run `harvest-axi entries today` to see today's entries, or `start`/`stop` a timer",
    "Run `harvest-axi review --team --this-week` to review the whole team",
  ];
  return output;
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
 * One API call → mutate `output` with active_timer?/today/last_entry?/recent.
 * On failure (or no user id) leaves `output` untouched so the home view still
 * renders identity + suggestions.
 */
async function applyRecency(output: Record<string, unknown>, userId: number | undefined): Promise<void> {
  if (!userId) return;
  let entries: Array<Record<string, unknown>>;
  try {
    const res = await harvestRequest<{ time_entries?: Array<Record<string, unknown>> }>(
      "time_entries",
      { query: { user_id: userId, per_page: 50 } },
    );
    entries = res.time_entries ?? [];
  } catch {
    return;
  }

  if (entries.length === 0) {
    output.today = "nothing logged yet";
    return;
  }

  // Active timer (omitted entirely when none is running).
  const running = entries.find((e) => e.is_running === true);
  if (running) {
    output.active_timer = `${projTask(running)} — ${round2(hoursOf(running))}h elapsed`;
  }

  // Today summary.
  const today = todayStr();
  const todays = entries.filter((e) => e.spent_date === today);
  output.today =
    todays.length > 0
      ? `${round2(todays.reduce((s, e) => s + hoursOf(e), 0))}h across ${todays.length} ${todays.length === 1 ? "entry" : "entries"}`
      : "nothing logged yet";

  // Recency.
  output.last_entry = daysAgoLabel(String(entries[0].spent_date ?? ""));
  output.recent = entries.slice(0, 3).map((e) => ({
    spent_date: e.spent_date,
    project: (e.project as { name?: string })?.name ?? "",
    task: (e.task as { name?: string })?.name ?? "",
    hours: e.hours,
  }));
}
