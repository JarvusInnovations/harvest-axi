import { AxiError } from "axi-sdk-js";
import {
  clearConfig,
  readConfig,
  resolveCredentials,
  writeConfig,
  type Credentials,
} from "../config.js";
import { fetchAccounts, whoMe } from "../harvest/identity.js";
import { renderObject } from "../output/index.js";

export const AUTH_HELP = `usage: harvest-axi auth <subcommand> [flags]
subcommands[3]:
  setup    connect a Harvest account (Personal Access Token + Account ID)
  whoami   show the configured account + user (--refresh to re-fetch)
  logout   remove stored credentials
setup flags:
  --token <pat>      Personal Access Token from https://id.getharvest.com/developers
  --account <id>     Harvest Account ID (auto-selected if your token sees exactly one)
whoami flags:
  --refresh          re-fetch identity from the API instead of using the cache
examples:
  harvest-axi auth setup --token pat_xxx --account 1234567
  harvest-axi auth whoami
  harvest-axi auth logout
notes:
  Credentials live in ~/.config/harvest-axi/config.json. The env vars
  HARVEST_ACCESS_TOKEN + HARVEST_ACCOUNT_ID override the file (for CI/cron).
`;

interface SetupFlags {
  token?: string;
  account?: string;
  refresh: boolean;
}

function parseFlags(args: string[]): SetupFlags {
  const flags: SetupFlags = { refresh: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--token":
        flags.token = next;
        i++;
        break;
      case "--account":
        flags.account = next;
        i++;
        break;
      case "--refresh":
        flags.refresh = true;
        break;
    }
  }
  return flags;
}

export async function authCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return AUTH_HELP;
  }

  const sub = args[0];
  const rest = args.slice(1);
  if (rest.includes("--help")) return AUTH_HELP;

  switch (sub) {
    case "setup":
      return authSetup(parseFlags(rest));
    case "whoami":
      return authWhoami(parseFlags(rest));
    case "logout":
      return authLogout();
    default:
      throw new AxiError(`Unknown auth subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `harvest-axi auth --help` to see available subcommands",
      ]);
  }
}

async function authSetup(flags: SetupFlags): Promise<string> {
  if (!flags.token) {
    // Not a prompt: fail fast with the instruction the agent/user needs.
    throw new AxiError(
      "A Harvest Personal Access Token is required",
      "VALIDATION_ERROR",
      [
        "Create a token at https://id.getharvest.com/developers",
        "Then run `harvest-axi auth setup --token <pat> [--account <id>]`",
        "The account id is auto-selected if your token can see exactly one Harvest account",
      ],
    );
  }

  // Resolve the account: explicit flag, else discover via the accounts endpoint.
  let accountId = flags.account;
  if (!accountId) {
    const accounts = await fetchAccounts(flags.token);
    if (accounts.length === 0) {
      throw new AxiError(
        "That token cannot access any Harvest accounts",
        "VALIDATION_ERROR",
        ["Confirm the token is a Harvest (not Forecast-only) Personal Access Token"],
      );
    }
    if (accounts.length === 1) {
      accountId = String(accounts[0].id);
    } else {
      throw new AxiError(
        `Your token sees ${accounts.length} Harvest accounts — pick one with --account <id>`,
        "VALIDATION_ERROR",
        accounts.map((a) => `--account ${a.id}  (${a.name})`),
      );
    }
  }

  const creds: Credentials = { token: flags.token, accountId, source: "config" };
  const profile = await whoMe(creds); // validates token + account

  writeConfig({
    version: readConfig().version,
    account_id: accountId,
    token: flags.token,
    default_user_id: profile.user_id,
    profile_cache: profile,
  });

  return renderObject({
    status: "connected",
    account: profile.account_name,
    account_id: accountId,
    user: profile.user_name,
    week_start_day: profile.week_start_day ?? "unknown",
    timer_mode: profile.wants_timestamp_timers ? "start/end" : "duration",
  });
}

async function authWhoami(flags: SetupFlags): Promise<string> {
  const creds = resolveCredentials();
  if (!creds) {
    return renderObject({
      status: "not configured",
      help: "Run `harvest-axi auth setup --token <pat>` to connect your Harvest account",
    });
  }

  const cfg = readConfig();
  let profile = cfg.profile_cache;
  if (flags.refresh || !profile) {
    profile = await whoMe(creds);
    if (creds.source === "config") {
      writeConfig({ ...cfg, profile_cache: profile, default_user_id: profile.user_id });
    }
  }

  return renderObject({
    account: profile.account_name,
    account_id: creds.accountId,
    user: profile.user_name,
    source: creds.source,
  });
}

function authLogout(): string {
  const hadConfig = resolveCredentials()?.source === "config";
  clearConfig();
  return renderObject({
    status: hadConfig ? "logged out (credentials removed)" : "no stored credentials (no-op)",
  });
}
