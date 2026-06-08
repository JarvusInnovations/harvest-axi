import { AxiError } from "axi-sdk-js";
import { resolveCredentials, type Credentials } from "../config.js";

const BASE_URL = "https://api.harvestapp.com/v2";
const USER_AGENT = "harvest-axi (https://github.com/JarvusInnovations/harvest-axi)";

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  /** Override resolved credentials (e.g. during `auth setup` validation). */
  credentials?: Credentials;
}

/** Get credentials or throw the canonical "not configured" AxiError. */
export function requireCredentials(): Credentials {
  const creds = resolveCredentials();
  if (!creds) {
    throw new AxiError(
      "No Harvest credentials configured",
      "TOKEN_INVALID",
      [
        "Run `harvest-axi auth setup --token <pat> --account <id>` to connect your account",
        "Create a Personal Access Token at https://id.getharvest.com/developers",
      ],
    );
  }
  return creds;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${BASE_URL}/${path.replace(/^\//, "")}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Translate a Harvest HTTP error response into an AxiError with an actionable
 * suggestion. Raw response bodies never reach stdout — we extract a message
 * and discard the noise (per the error-translation principle).
 */
async function translateHarvestError(
  res: Response,
  operation: string,
): Promise<AxiError> {
  let detail = "";
  try {
    const text = await res.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; error_description?: string };
        detail = parsed.message ?? parsed.error_description ?? text;
      } catch {
        detail = text;
      }
    }
  } catch {
    // ignore body read failures — status code is enough
  }
  detail = detail.slice(0, 300);

  switch (res.status) {
    case 401:
      return new AxiError(
        "Harvest authentication failed — token invalid or revoked",
        "TOKEN_INVALID",
        ["Run `harvest-axi auth setup` to reconnect with a valid Personal Access Token"],
      );
    case 403:
      return new AxiError(
        `Forbidden on ${operation} — your token's role lacks access${detail ? `: ${detail}` : ""}`,
        "FORBIDDEN",
        ["A manager/admin token is required for team-wide or other users' data"],
      );
    case 404:
      return new AxiError(
        `Not found on ${operation}${detail ? `: ${detail}` : ""}`,
        "NOT_FOUND",
        ["Run `harvest-axi browse projects` / `browse clients` to find valid ids"],
      );
    case 422:
      return new AxiError(
        `Harvest rejected the request${detail ? `: ${detail}` : ""}`,
        "VALIDATION_ERROR",
        ["Check the field values; `harvest-axi browse mine` shows your assignable projects/tasks"],
      );
    case 429: {
      const retry = res.headers.get("Retry-After");
      return new AxiError(
        `Rate limited on ${operation}`,
        "RATE_LIMITED",
        [retry ? `Retry after ${retry} seconds` : "Retry after a short wait"],
      );
    }
    default:
      if (res.status >= 500) {
        return new AxiError(
          `Harvest server error (${res.status}) on ${operation}`,
          "SERVER_ERROR",
          ["Retry after a moment"],
        );
      }
      return new AxiError(
        `Harvest API error ${res.status} on ${operation}${detail ? `: ${detail}` : ""}`,
        `HARVEST_API_ERROR_${res.status}`,
        [],
      );
  }
}

/**
 * Make an authed Harvest request. Injects the three required headers, sends
 * JSON for bodies, parses JSON responses, and translates errors. DELETE and
 * other empty 2xx responses resolve to an empty object.
 */
export async function harvestRequest<T = Record<string, unknown>>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const creds = options.credentials ?? requireCredentials();
  const method = options.method ?? "GET";
  const operation = `${method} ${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    "Harvest-Account-Id": creds.accountId,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), init);
  } catch (err) {
    throw new AxiError(
      `Network error on ${operation}: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK_ERROR",
      ["Check connectivity and retry"],
    );
  }

  if (!res.ok) throw await translateHarvestError(res, operation);

  // 204 / empty body (e.g. DELETE) → empty object.
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}
