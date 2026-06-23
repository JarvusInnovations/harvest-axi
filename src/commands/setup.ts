import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { joinBlocks, renderHelp, renderObject } from "../output/index.js";

export const SETUP_HELP = `usage: harvest-axi setup hooks
Install or repair agent SessionStart hooks so each session starts with harvest-axi's
home view (today's entries + recent activity) as ambient context. Installs to Claude
Code, Codex, and OpenCode. Idempotent; repairs a stale executable path.
examples:
  harvest-axi setup hooks`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return SETUP_HELP;
  if (args[0] !== "hooks") {
    throw new AxiError(`Unknown setup action: ${args[0] ?? "(none)"}`, "VALIDATION_ERROR", [
      "Run `harvest-axi setup hooks`",
    ]);
  }

  const errors: string[] = [];
  installSessionStartHooks({ marker: "harvest-axi", timeoutSeconds: 10, onError: (m) => errors.push(m) });
  if (errors.length > 0) {
    throw new AxiError("Hook installation reported problems", "HOOK_INSTALL_FAILED", errors);
  }

  return joinBlocks(
    renderObject({ hooks: { status: "installed", integrations: "Claude Code, Codex, OpenCode", marker: "harvest-axi" } }),
    renderHelp(["Restart your agent session to receive harvest-axi ambient context"]),
  );
}
