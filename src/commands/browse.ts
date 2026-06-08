import { AxiError } from "axi-sdk-js";
import { paginateAll } from "../harvest/paginate.js";
import { resolveEntity } from "../harvest/resolve.js";
import type { QueryValue } from "../harvest/client.js";
import {
  computed,
  field,
  pluck,
  renderListResponse,
  truncated,
  type FieldDef,
} from "../output/index.js";

export const BROWSE_HELP = `usage: harvest-axi browse <subcommand> [flags]
subcommands[4]:
  clients     clients on the account
  projects    projects (--client <id|name> to filter)
  tasks       task types
  mine        your project assignments (what you can log against, + tasks)
flags:
  --all        include archived/inactive (default: active only)
  --client <id|name>   (projects only) filter to one client
  --refresh    bypass the name-resolution cache
examples:
  harvest-axi browse clients
  harvest-axi browse projects --client "Caltrans"
  harvest-axi browse mine
notes:
  Names from these lists resolve in review/entries scope flags (e.g.
  \`review --client "Caltrans"\`), backed by a cached id lookup.
`;

interface BrowseFlags {
  all: boolean;
  client?: string;
  refresh: boolean;
}

function parseFlags(args: string[]): BrowseFlags {
  const flags: BrowseFlags = { all: false, refresh: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--all":
        flags.all = true;
        break;
      case "--client":
        flags.client = args[i + 1];
        i++;
        break;
      case "--refresh":
        flags.refresh = true;
        break;
    }
  }
  return flags;
}

const activeCol = computed("active", (i) => i.is_active);

export async function browseCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return BROWSE_HELP;
  }
  const sub = args[0];
  const rest = args.slice(1);
  if (rest.includes("--help")) return BROWSE_HELP;
  const flags = parseFlags(rest);

  switch (sub) {
    case "clients":
      return browseList("clients", "clients", flags, [
        field("id"),
        truncated("name", 50),
        activeCol,
      ]);
    case "projects": {
      const query: Record<string, QueryValue> = {};
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
    case "tasks":
      return browseList("tasks", "tasks", flags, [
        field("id"),
        truncated("name", 50),
        computed("billable_default", (i) => i.billable_by_default),
        activeCol,
      ]);
    case "mine":
      return browseMine();
    default:
      throw new AxiError(`Unknown browse subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `harvest-axi browse --help` to see available subcommands",
      ]);
  }
}

async function browseList(
  path: string,
  key: string,
  flags: BrowseFlags,
  schema: FieldDef[],
  query: Record<string, QueryValue> = {},
): Promise<string> {
  const res = await paginateAll<Record<string, unknown>>(path, key, query);
  let items = res.items;
  if (!flags.all) items = items.filter((i) => i.is_active !== false);

  const suggestions: string[] = [];
  if (items.length > 0) {
    if (key === "projects") suggestions.push('Run `harvest-axi review --project "<name>" --by task` to review one project');
    else if (key === "clients") suggestions.push('Run `harvest-axi review --client "<name>" --by project` to review one client');
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
