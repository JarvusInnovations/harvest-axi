import { AxiError } from "axi-sdk-js";
import type { Credentials, ProfileCache } from "../config.js";
import { harvestRequest } from "./client.js";

const ID_ACCOUNTS_URL = "https://id.getharvest.com/api/v2/accounts";
const USER_AGENT = "harvest-axi (https://github.com/JarvusInnovations/harvest-axi)";

export interface HarvestAccount {
  id: number;
  name: string;
  product: string;
}

interface UsersMeResponse {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
}

interface CompanyResponse {
  name?: string;
  week_start_day?: string;
  wants_timestamp_timers?: boolean;
  base_uri?: string;
}

/**
 * List the Harvest accounts a token can access via the id.getharvest.com
 * accounts endpoint (no account header needed). Filters to the "harvest"
 * product (excludes Forecast). Used by `auth setup` to auto-select a single
 * account or list candidates when several exist.
 */
export async function fetchAccounts(token: string): Promise<HarvestAccount[]> {
  let res: Response;
  try {
    res = await fetch(ID_ACCOUNTS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new AxiError(
      `Network error contacting Harvest ID: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK_ERROR",
      ["Check connectivity and retry"],
    );
  }

  if (res.status === 401) {
    throw new AxiError(
      "That Personal Access Token was rejected by Harvest",
      "TOKEN_INVALID",
      ["Mint a fresh token at https://id.getharvest.com/developers and pass it via --token"],
    );
  }
  if (!res.ok) {
    throw new AxiError(
      `Harvest ID returned ${res.status} while listing accounts`,
      "SERVER_ERROR",
      ["Retry after a moment"],
    );
  }

  const body = (await res.json()) as { accounts?: HarvestAccount[] };
  return (body.accounts ?? []).filter((a) => a.product === "harvest");
}

/**
 * Validate credentials and resolve identity: the authenticated user (from
 * /v2/users/me) plus account name + preferences (from /v2/company). Returns a
 * ProfileCache ready to persist.
 */
export async function whoMe(creds: Credentials): Promise<ProfileCache> {
  const me = await harvestRequest<UsersMeResponse>("users/me", { credentials: creds });
  const company = await harvestRequest<CompanyResponse>("company", { credentials: creds });

  const userName = [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email || `user ${me.id}`;

  return {
    user_id: me.id,
    user_name: userName,
    account_name: company.name ?? `account ${creds.accountId}`,
    week_start_day: company.week_start_day,
    wants_timestamp_timers: company.wants_timestamp_timers,
    base_uri: company.base_uri,
    cached_at: new Date().toISOString(),
  };
}
