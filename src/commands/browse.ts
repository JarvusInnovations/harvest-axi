import { AxiError } from "axi-sdk-js";
import { readConfig } from "../config.js";
import { harvestRequest } from "../harvest/client.js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity, type EntityKind } from "../harvest/resolve.js";
import type { QueryValue } from "../harvest/client.js";
import {
  computed,
  field,
  joinBlocks,
  pluck,
  renderHelp,
  renderList,
  renderListResponse,
  renderObject,
  truncated,
  type FieldDef,
} from "../output/index.js";
import { parseRange } from "../time/ranges.js";

export const BROWSE_HELP = `usage: harvest-axi browse <subcommand> [<id|name>] [flags]
list subcommands[6]:
  clients     clients on the account
  projects    projects (--client <id|name> to filter)
  tasks       task types
  users       people on the account
  contacts    client contacts (--client <id|name> to filter)
  mine        your project assignments (what you can log against, + tasks)
detail (one entity, full record):
  browse clients <id|name>     browse projects <id|name>
  browse tasks <id|name>       browse users <id|name>|me
  browse contacts <id>         (contacts are id-keyed, not name-resolved)
  (clients detail folds in contacts; projects detail folds in task assignments)
flags:
  --all        include archived/inactive (default: active only)
  --client <id|name>   (projects, contacts) filter to one client
  --since <dur>        only entities updated within 7d | 2w | 1m
  --refresh    bypass the name-resolution cache
examples:
  harvest-axi browse clients
  harvest-axi browse projects --client "Caltrans"
  harvest-axi browse contacts --client "Caltrans"
  harvest-axi browse users me
notes:
  Names from these lists resolve in review/entries scope flags (e.g.
  \`review --client "Caltrans"\`), backed by a cached id lookup.
`;

interface BrowseFlags {
  all: boolean;
  client?: string;
  since?: string;
  refresh: boolean;
}

/** Split positionals (id/name) from flags; only a non-`--` token is a positional. */
function parseArgs(args: string[]): { flags: BrowseFlags; positionals: string[] } {
  const flags: BrowseFlags = { all: false, refresh: false };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--all": flags.all = true; break;
      case "--client": flags.client = args[i + 1]; i++; break;
      case "--since": flags.since = args[i + 1]; i++; break;
      case "--refresh": flags.refresh = true; break;
      default:
        if (!args[i].startsWith("--")) positionals.push(args[i]);
        break;
    }
  }
  return { flags, positionals };
}

const activeCol = computed("active", (i) => i.is_active);

/** Map a since-duration to an updated_since ISO timestamp, or throw on bad input. */
function sinceQuery(since: string | undefined): Record<string, QueryValue> {
  if (!since) return {};
  // Reuse the range parser (throws VALIDATION_ERROR on unparseable input) — its
  // `from` is the YYYY-MM-DD window start, which we hand to updated_since.
  const { from } = parseRange({ since });
  return { updated_since: `${from}T00:00:00Z` };
}

export async function browseCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return BROWSE_HELP;
  }
  const sub = args[0];
  const rest = args.slice(1);
  if (rest.includes("--help")) return BROWSE_HELP;
  const { flags, positionals } = parseArgs(rest);

  // A trailing positional turns a list subcommand into a detail view.
  const id = positionals[0];

  switch (sub) {
    case "clients":
      return id
        ? clientDetail(id, flags)
        : browseList("clients", "clients", flags, [field("id"), truncated("name", 50), activeCol]);
    case "projects":
      return id ? projectDetail(id, flags) : projectsList(flags);
    case "tasks":
      return id
        ? taskDetail(id, flags)
        : browseList("tasks", "tasks", flags, [
            field("id"),
            truncated("name", 50),
            computed("billable_default", (i) => i.billable_by_default),
            activeCol,
          ]);
    case "users":
      return id ? userDetail(id, flags) : usersList(flags);
    case "contacts":
      return id ? contactDetail(id) : contactsList(flags);
    case "mine":
      return browseMine();
    default:
      throw new AxiError(`Unknown browse subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `harvest-axi browse --help` to see available subcommands",
      ]);
  }
}

async function projectsList(flags: BrowseFlags): Promise<string> {
  const query: Record<string, QueryValue> = { ...sinceQuery(flags.since) };
  if (flags.client) {
    query.client_id = (await resolveEntity("client", flags.client, { refresh: flags.refresh })).id;
  }
  return browseList(
    "projects",
    "projects",
    flags,
    [field("id"), truncated("name", 50), pluck("client", "name", "client"), field("code"), activeCol],
    query,
  );
}

async function usersList(flags: BrowseFlags): Promise<string> {
  return browseList(
    "users",
    "users",
    flags,
    [
      field("id"),
      computed("name", (i) => userName(i)),
      field("email"),
      computed("roles", (i) => (Array.isArray(i.access_roles) ? (i.access_roles as string[]).join("/") : "")),
      activeCol,
    ],
    sinceQuery(flags.since),
  );
}

function contactName(c: Record<string, unknown>): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return name || (c.email as string) || `contact ${c.id}`;
}

function contactPhone(c: Record<string, unknown>): string {
  return (c.phone_office as string) || (c.phone_mobile as string) || "—";
}

async function contactsList(flags: BrowseFlags): Promise<string> {
  const query: Record<string, QueryValue> = { ...sinceQuery(flags.since) };
  const scope: string[] = [];
  if (flags.client) {
    const c = await resolveEntity("client", flags.client, { refresh: flags.refresh });
    query.client_id = c.id;
    scope.push(`client ${c.name}`);
  }
  const res = await paginateAll<Record<string, unknown>>("contacts", "contacts", query);
  return renderListResponse({
    summary: { total: res.items.length, ...(scope.length ? { scope: scope.join(" · ") } : {}) },
    name: "contacts",
    items: res.items,
    schema: [
      field("id"),
      computed("name", (i) => contactName(i)),
      pluck("client", "name", "client"),
      field("email"),
      computed("phone", (i) => contactPhone(i)),
    ],
    suggestions: res.items.length > 0 ? ["Run `harvest-axi browse contacts <id>` for one contact's full record"] : [],
    emptyMessage: `0 contacts found${scope.length ? ` for ${scope.join(" · ")}` : ""}`,
  });
}

async function contactDetail(value: string): Promise<string> {
  if (!/^\d+$/.test(value)) {
    throw new AxiError(`browse contacts takes a numeric contact id, got "${value}"`, "VALIDATION_ERROR", [
      "Contacts aren't name-resolved — run `harvest-axi browse contacts --client \"<name>\"` to find ids",
    ]);
  }
  const c = await harvestRequest<Record<string, unknown>>(`contacts/${value}`);
  return renderObject({
    id: c.id,
    name: contactName(c),
    title: c.title || "—",
    client: (c.client as { name?: string } | undefined)?.name ?? "—",
    email: c.email ?? "—",
    phone_office: c.phone_office || "—",
    phone_mobile: c.phone_mobile || "—",
    invoice_recipient_status: c.invoice_recipient_status ?? "—",
  });
}

async function browseList(
  path: string,
  key: string,
  flags: BrowseFlags,
  schema: FieldDef[],
  query: Record<string, QueryValue> = {},
): Promise<string> {
  const mergedQuery = key === "projects" || key === "users" ? query : { ...query, ...sinceQuery(flags.since) };
  const res = await paginateAll<Record<string, unknown>>(path, key, mergedQuery);
  let items = res.items;
  if (!flags.all) items = items.filter((i) => i.is_active !== false);

  const suggestions: string[] = [];
  if (items.length > 0) {
    if (key === "projects") suggestions.push('Run `harvest-axi browse projects "<name>"` for one project\'s detail + tasks');
    else if (key === "clients") suggestions.push('Run `harvest-axi review --client "<name>" --by project` to review one client');
    else if (key === "users") suggestions.push('Run `harvest-axi browse users <id|name>` for one user\'s full record');
    else suggestions.push("Run `harvest-axi browse mine` to see which projects/tasks you can log against");
    if (!flags.all) suggestions.push("Add `--all` to include archived/inactive");
  }

  return renderListResponse({
    summary: { total: items.length, active_only: !flags.all },
    name: key,
    items,
    schema,
    suggestions,
    emptyMessage: `0 ${flags.all ? "" : "active "}${key} found`,
  });
}

// ── Detail views ────────────────────────────────────────────────────────────

function userName(u: Record<string, unknown>): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return name || (u.email as string) || `user ${u.id}`;
}

/** Resolve a positional id/name to a numeric id for a detail fetch. */
async function resolveId(kind: EntityKind, value: string, flags: BrowseFlags): Promise<number> {
  return (await resolveEntity(kind, value, { refresh: flags.refresh })).id;
}

async function clientDetail(value: string, flags: BrowseFlags): Promise<string> {
  const id = await resolveId("client", value, flags);
  const c = await harvestRequest<Record<string, unknown>>(`clients/${id}`);
  const contacts = await paginateAll<Record<string, unknown>>("contacts", "contacts", { client_id: id });

  const blocks = [
    renderObject({
      client: {
        id: c.id,
        name: c.name,
        active: c.is_active,
        currency: c.currency ?? "—",
        address: c.address || "—",
        statement_key: c.statement_key ?? "—",
        created_at: c.created_at,
        updated_at: c.updated_at,
      },
    }),
  ];
  if (contacts.items.length > 0) {
    blocks.push(
      renderList("contacts", contacts.items, [
        { name: "name", extract: (i) => contactName(i) },
        { name: "title", extract: (i) => i.title || "—" },
        { name: "email", extract: (i) => i.email ?? "—" },
        { name: "phone", extract: (i) => contactPhone(i) },
      ]),
    );
  } else {
    blocks.push(renderObject({ contacts: "no contacts on this client" }));
  }
  return joinBlocks(...blocks);
}

async function taskDetail(value: string, flags: BrowseFlags): Promise<string> {
  const id = await resolveId("task", value, flags);
  const t = await harvestRequest<Record<string, unknown>>(`tasks/${id}`);
  return renderObject({
    id: t.id,
    name: t.name,
    billable_by_default: t.billable_by_default,
    default_hourly_rate: t.default_hourly_rate ?? "—",
    is_default: t.is_default,
    active: t.is_active,
    created_at: t.created_at,
    updated_at: t.updated_at,
  });
}

async function userDetail(value: string, flags: BrowseFlags): Promise<string> {
  // `me` (or no resolvable name) → the authenticated user, which works for any role.
  const u =
    value.toLowerCase() === "me"
      ? await harvestRequest<Record<string, unknown>>("users/me")
      : await harvestRequest<Record<string, unknown>>(`users/${await resolveId("user", value, flags)}`);

  const capSeconds = typeof u.weekly_capacity === "number" ? u.weekly_capacity : 0;
  return renderObject({
    id: u.id,
    name: userName(u),
    email: u.email ?? "—",
    telephone: u.telephone || "—",
    timezone: u.timezone ?? "—",
    access_roles: Array.isArray(u.access_roles) ? (u.access_roles as string[]).join(", ") : "—",
    roles: Array.isArray(u.roles) && u.roles.length ? (u.roles as string[]).join(", ") : "—",
    is_contractor: u.is_contractor,
    weekly_capacity_hours: capSeconds ? Math.round((capSeconds / 3600) * 100) / 100 : "—",
    default_hourly_rate: u.default_hourly_rate ?? "—",
    cost_rate: u.cost_rate ?? "—",
    active: u.is_active,
  });
}

async function projectDetail(value: string, flags: BrowseFlags): Promise<string> {
  const id = await resolveId("project", value, flags);
  const p = await harvestRequest<Record<string, unknown>>(`projects/${id}`);
  const assignments = await paginateAll<Record<string, unknown>>(
    `projects/${id}/task_assignments`,
    "task_assignments",
  );
  const activeTasks = assignments.items.filter((a) => a.is_active !== false);

  const header = {
    id: p.id,
    name: p.name,
    code: p.code || "—",
    client: (p.client as { name?: string } | undefined)?.name ?? "—",
    active: p.is_active,
    is_billable: p.is_billable,
    is_fixed_fee: p.is_fixed_fee,
    bill_by: p.bill_by ?? "—",
    hourly_rate: p.hourly_rate ?? "—",
    budget: p.budget ?? "—",
    budget_by: p.budget_by ?? "—",
    cost_budget: p.cost_budget ?? "—",
    fee: p.fee ?? "—",
    starts_on: p.starts_on ?? "—",
    ends_on: p.ends_on ?? "—",
    created_at: p.created_at,
    updated_at: p.updated_at,
  };

  const blocks = [renderObject({ project: header })];
  if (p.notes) blocks.push(renderObject({ notes: p.notes }));
  blocks.push(
    renderList("tasks", activeTasks, [
      { name: "task", extract: (i) => (i.task as { name?: string } | undefined)?.name ?? "—" },
      { name: "billable", extract: (i) => i.billable },
      { name: "hourly_rate", extract: (i) => i.hourly_rate ?? "—" },
      { name: "active", extract: (i) => i.is_active },
    ]),
  );
  blocks.push(
    renderHelp([
      `Run \`harvest-axi review --project "${p.name}" --by task\` to review this project`,
      'Run `harvest-axi entries log --project "<name>" --task "<name>" --hours <h>` to log against a task',
    ]),
  );
  return joinBlocks(...blocks);
}

async function browseMine(): Promise<string> {
  const res = await paginateAll<Record<string, unknown>>(
    "users/me/project_assignments",
    "project_assignments",
  );
  const active = res.items.filter((a) => a.is_active !== false);

  const rows = active.map((a) => {
    const project = a.project as { name?: string } | undefined;
    const client = a.client as { name?: string } | undefined;
    const taskAssignments = (a.task_assignments as Array<{ task?: { name?: string } }>) ?? [];
    const taskNames = taskAssignments.map((t) => t.task?.name).filter(Boolean);
    const tasksLabel =
      taskNames.length <= 4
        ? taskNames.join(", ")
        : `${taskNames.slice(0, 4).join(", ")} +${taskNames.length - 4} more`;
    return {
      project: project?.name ?? "—",
      client: client?.name ?? "—",
      tasks: tasksLabel || "(none)",
    };
  });

  return renderListResponse({
    summary: { total: rows.length },
    name: "assignments",
    items: rows,
    schema: [
      truncated("project", 45),
      truncated("client", 30),
      truncated("tasks", 70),
    ],
    suggestions:
      rows.length > 0
        ? ["Run `harvest-axi entries log --project \"<name>\" --task \"<name>\" --hours <h>` to log time (entries plan)"]
        : [],
    emptyMessage: "0 active project assignments — ask an admin to assign you to a project",
  });
}
