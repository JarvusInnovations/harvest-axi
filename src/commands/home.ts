import { isConfigured, readConfig } from "../config.js";

/**
 * No-args home view. Foundation version: identity from cache + setup state +
 * review-leaning suggestions. The live "today" line is added in the `ambient`
 * plan (it needs entry reads), per specs/commands/home.md.
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

  output.help = [
    "Run `harvest-axi review --since 7d` to review your last week",
    "Run `harvest-axi review --team --this-week` to review the whole team",
    "Run `harvest-axi --help` for the full command list, or `<command> --help` for usage",
  ];
  return output;
}
