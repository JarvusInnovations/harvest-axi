import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { homeCommand } from "./commands/home.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { doctorCommand, DOCTOR_HELP } from "./commands/doctor.js";
import { reviewCommand, REVIEW_HELP } from "./commands/review.js";
import { browseCommand, BROWSE_HELP } from "./commands/browse.js";
import { stubCommand } from "./commands/stub.js";

const DESCRIPTION =
  "AXI CLI for Harvest time tracking — review, log, and edit time entries.";

const VERSION = readPackageVersion();

export const TOP_HELP = `usage: harvest-axi [command] [args] [flags]
commands[6]:
  (none)=home, auth, doctor, review, entries, browse
flags[2]:
  --help, -v/-V/--version
examples:
  harvest-axi
  harvest-axi auth setup --token <pat> --account <id>
  harvest-axi review --since 7d
  harvest-axi review --team --this-week
`;

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(process.env.HARVEST_AXI_DISABLE_HOOKS === "1" ? { hooks: false } : {}),
    home: async () => homeCommand(),
    commands: {
      auth: authCommand,
      doctor: async () => doctorCommand(),
      review: reviewCommand,
      browse: browseCommand,
      // Stubs until each plan lands — see plans/<slug>.md.
      entries: stubCommand("entries", "entries-write"),
    },
    getCommandHelp: (command) =>
      ({ auth: AUTH_HELP, doctor: DOCTOR_HELP, review: REVIEW_HELP, browse: BROWSE_HELP }[command]),
  });
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }
  throw new Error("Could not determine harvest-axi package version");
}
