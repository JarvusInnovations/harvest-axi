import { isConfigured, readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { parseRange } from "../time/ranges.js";

/**
 * No-args home view (also the SessionStart hook payload). Per "content first":
 * identity + a live "today" line + review-leaning suggestions. Token-budget
 * discipline: at most ONE live API call (today's own entries); everything else
 * is config/cache, and the today line degrades gracefully on failure.
 */
export async function homeCommand(): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {};

  if (!isConfigured()) {
    output.setup = "no Harvest credentials configured";
    output.help = [
      "Run `harvest-axi auth setup --token <pat> --account <id>` to connect your Harvest account",
      "Create a Personal Access Token at https://id.getharvest.com/developers",
    ];
    return output;
  }

  const cfg = readConfig();
  if (cfg.profile_cache) {
    output.account = cfg.profile_cache.account_name;
    output.user = cfg.profile_cache.user_name;
  }

  const today = await todayLine(cfg.default_user_id);
  if (today) output.today = today;

  output.help = [
    "Run `harvest-axi review --since 7d` to review your last week",
    "Run `harvest-axi review --team --this-week` to review the whole team",
    "Run `harvest-axi --help` for the full command list, or `<command> --help` for usage",
  ];
  return output;
}

/** One API call: today's own entries → "5.25h across 3 entries · timer running…". */
async function todayLine(userId: number | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const date = parseRange({ named: "today" }).from;
    const res = await harvestRequest<{ time_entries?: Array<Record<string, unknown>> }>(
      "time_entries",
      { query: { from: date, to: date, user_id: userId } },
    );
    const entries = res.time_entries ?? [];
    if (entries.length === 0) return "nothing logged yet";

    const total = entries.reduce((s, e) => s + (typeof e.hours === "number" ? e.hours : 0), 0);
    let line = `${Math.round(total * 100) / 100}h across ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;

    const running = entries.find((e) => e.is_running === true);
    if (running) {
      const project = (running.project as { name?: string })?.name ?? "?";
      const task = (running.task as { name?: string })?.name ?? "?";
      line += ` · timer running on "${project} / ${task}"`;
    }
    return line;
  } catch {
    // Degrade gracefully — identity + suggestions still render without this line.
    return undefined;
  }
}
