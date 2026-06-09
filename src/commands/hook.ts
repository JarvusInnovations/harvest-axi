import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";

export const HOOK_HELP = `usage: harvest-axi hook <subcommand>
subcommands[3]:
  status     (default) show whether the SessionStart hook is installed per agent
  install    install or repair the hook (Claude Code + Codex); idempotent
  uninstall  remove harvest-axi's SessionStart hook from both agents
notes:
  The hook injects the home view at session start. \`auth setup\` also installs
  it as a convenience; this command is the explicit manager. Set
  HARVEST_AXI_DISABLE_HOOKS=1 to suppress installation everywhere.
`;

const MARKER = "harvest-axi";

interface Target {
  agent: string;
  path: string;
}

function targets(): Target[] {
  const home = homedir();
  return [
    { agent: "Claude Code", path: join(home, ".claude", "settings.json") },
    { agent: "Codex", path: join(home, ".codex", "hooks.json") },
  ];
}

interface HookGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sessionStartGroups(json: Record<string, unknown> | null): HookGroup[] {
  const hooks = json?.hooks as { SessionStart?: HookGroup[] } | undefined;
  return hooks?.SessionStart ?? [];
}

function isOurs(group: HookGroup): boolean {
  return (group.hooks ?? []).some(
    (h) => typeof h.command === "string" && h.command.includes(MARKER),
  );
}

function ourCommand(group: HookGroup | undefined): string {
  return group?.hooks?.find((h) => h.command?.includes(MARKER))?.command ?? "";
}

export async function hookCommand(args: string[]): Promise<string> {
  if (args.length === 1 && args[0] === "--help") return HOOK_HELP;
  const sub = args[0] ?? "status";
  if (args.includes("--help")) return HOOK_HELP;

  switch (sub) {
    case "status":
      return hookStatus();
    case "install":
      return hookInstall();
    case "uninstall":
      return hookUninstall();
    default:
      throw new AxiError(`Unknown hook subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `harvest-axi hook --help` to see available subcommands",
      ]);
  }
}

function statusRows(): Array<Record<string, unknown>> {
  return targets().map((t) => {
    const group = sessionStartGroups(readJson(t.path)).find(isOurs);
    return { agent: t.agent, installed: !!group, command: ourCommand(group) };
  });
}

function renderStatus(suggestions: string[]): string {
  return joinBlocks(
    renderList("hooks", statusRows(), [
      { name: "agent", extract: (i) => i.agent },
      { name: "installed", extract: (i) => i.installed },
      { name: "command", extract: (i) => i.command },
    ]),
    renderHelp(suggestions),
  );
}

function hookStatus(): string {
  const anyInstalled = statusRows().some((r) => r.installed);
  return renderStatus([
    anyInstalled
      ? "Run `harvest-axi hook uninstall` to remove the session hook"
      : "Run `harvest-axi hook install` to load the home view at session start",
    "Run `harvest-axi --help` to see the full command list, or `<command> --help` for usage on any command",
  ]);
}

function hookInstall(): string {
  if (process.env.HARVEST_AXI_DISABLE_HOOKS === "1") {
    return renderObject({
      status: "skipped — HARVEST_AXI_DISABLE_HOOKS=1 is set (no changes made)",
    });
  }
  let error: string | undefined;
  installSessionStartHooks({ onError: (m) => (error = m) });
  return joinBlocks(
    renderObject({
      status: error ? `completed with a warning: ${error}` : "installed/repaired (Claude Code + Codex)",
    }),
    renderStatus(["Run `harvest-axi hook uninstall` to remove it"]),
  );
}

function hookUninstall(): string {
  const cleared: string[] = [];
  for (const t of targets()) {
    const json = readJson(t.path);
    if (!json) continue;
    const groups = sessionStartGroups(json);
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length === groups.length) continue; // nothing ours here

    (json.hooks as { SessionStart?: HookGroup[] }).SessionStart = kept;
    try {
      writeFileSync(t.path, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
      cleared.push(t.agent);
    } catch (err) {
      throw new AxiError(
        `Failed to update ${t.path}: ${err instanceof Error ? err.message : String(err)}`,
        "IO_ERROR",
        ["Check file permissions and retry"],
      );
    }
  }

  if (cleared.length === 0) {
    return renderObject({ status: "no harvest-axi session hook was installed (no-op)" });
  }
  return renderObject({ status: `removed from ${cleared.join(", ")}` });
}
