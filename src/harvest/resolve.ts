import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { cacheDir } from "../config.js";
import { paginateAll } from "./paginate.js";

export interface NamedEntity {
  id: number;
  name: string;
}

export type EntityKind = "client" | "project" | "task" | "user";

const SOURCES: Record<EntityKind, { path: string; key: string }> = {
  client: { path: "clients", key: "clients" },
  project: { path: "projects", key: "projects" },
  task: { path: "tasks", key: "tasks" },
  user: { path: "users", key: "users" },
};

// Reference data changes rarely; a 1h TTL keeps name→id resolution a single
// cached round-trip while staying fresh enough. `--refresh` forces a re-fetch.
const TTL_MS = 60 * 60 * 1000;

function cacheFile(kind: EntityKind): string {
  return join(cacheDir(), `${kind}.json`);
}

function nameOf(kind: EntityKind, item: Record<string, unknown>): string {
  if (kind === "user") {
    const name = [item.first_name, item.last_name].filter(Boolean).join(" ");
    return name || (item.email as string) || `user ${item.id}`;
  }
  return (item.name as string) ?? `#${item.id}`;
}

/** Load reference entities for `kind`, cached on disk with a TTL. */
export async function loadEntities(
  kind: EntityKind,
  opts: { refresh?: boolean } = {},
): Promise<NamedEntity[]> {
  const file = cacheFile(kind);
  if (!opts.refresh && existsSync(file)) {
    try {
      if (Date.now() - statSync(file).mtimeMs < TTL_MS) {
        return JSON.parse(readFileSync(file, "utf-8")) as NamedEntity[];
      }
    } catch {
      // fall through to a fresh fetch
    }
  }

  const { path, key } = SOURCES[kind];
  const res = await paginateAll<Record<string, unknown>>(path, key, {});
  const items = res.items.map((i) => ({ id: Number(i.id), name: nameOf(kind, i) }));
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(file, JSON.stringify(items));
  } catch {
    // a write failure just means the next call re-fetches — not fatal
  }
  return items;
}

const PLURAL: Record<EntityKind, string> = {
  client: "clients",
  project: "projects",
  task: "tasks",
  user: "users",
};

/**
 * Resolve a name-or-id to a NamedEntity. Numeric input passes through as an id.
 * Name input matches case-insensitively: an exact name wins; otherwise a unique
 * substring match wins; zero or multiple matches raise a VALIDATION_ERROR with
 * candidates rather than guessing.
 */
export async function resolveEntity(
  kind: EntityKind,
  value: string,
  opts: { refresh?: boolean } = {},
): Promise<NamedEntity> {
  if (/^\d+$/.test(value)) return { id: Number(value), name: `#${value}` };

  const items = await loadEntities(kind, opts);
  const lower = value.toLowerCase();

  const exact = items.filter((i) => i.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];

  const matches = exact.length > 0 ? exact : items.filter((i) => i.name.toLowerCase().includes(lower));
  if (matches.length === 1) return matches[0];

  const browseHint =
    kind === "user"
      ? `Pass a numeric --user id (no \`browse users\` view)`
      : `Run \`harvest-axi browse ${PLURAL[kind]}\` to list valid ${PLURAL[kind]}`;

  if (matches.length === 0) {
    throw new AxiError(`No ${kind} matching "${value}"`, "VALIDATION_ERROR", [browseHint]);
  }
  throw new AxiError(
    `"${value}" matches ${matches.length} ${PLURAL[kind]} — be more specific`,
    "VALIDATION_ERROR",
    matches.slice(0, 10).map((i) => `${i.id}  ${i.name}`),
  );
}
