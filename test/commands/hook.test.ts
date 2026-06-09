import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hookCommand } from "../../src/commands/hook.js";

let home: string;
const claudePath = () => join(home, ".claude", "settings.json");
const codexPath = () => join(home, ".codex", "hooks.json");

function group(command: string) {
  return { matcher: "", hooks: [{ type: "command", command, timeout: 10 }] };
}

function writeClaude(commands: string[]) {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(claudePath(), JSON.stringify({ hooks: { SessionStart: commands.map(group) } }, null, 2));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "harvest-axi-home-"));
  vi.stubEnv("HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("hook", () => {
  it("status reports installed + command when our hook is present (others ignored)", async () => {
    writeClaude(["gh-axi", "harvest-axi"]);
    const out = await hookCommand(["status"]);
    expect(out).toContain("hooks[2]{agent,installed,command}:");
    expect(out).toMatch(/Claude Code,true,harvest-axi/);
    expect(out).toMatch(/Codex,false,/); // no codex file
  });

  it("status reports not-installed when absent", async () => {
    writeClaude(["gh-axi"]);
    const out = await hookCommand([]); // bare → status
    expect(out).toMatch(/Claude Code,false,/);
    expect(out).toContain("hook install");
  });

  it("install is a no-op that says so when disabled via env", async () => {
    vi.stubEnv("HARVEST_AXI_DISABLE_HOOKS", "1");
    const out = await hookCommand(["install"]);
    expect(out).toContain("HARVEST_AXI_DISABLE_HOOKS");
  });

  it("uninstall removes only our entry, leaving others; second run is a no-op", async () => {
    writeClaude(["gh-axi", "harvest-axi", "gws-axi"]);
    const out = await hookCommand(["uninstall"]);
    expect(out).toContain("removed from Claude Code");

    const settings = JSON.parse(readFileSync(claudePath(), "utf-8"));
    const cmds = settings.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(cmds).toEqual(["gh-axi", "gws-axi"]); // harvest-axi gone, others kept

    const again = await hookCommand(["uninstall"]);
    expect(again).toContain("no-op");
  });

  it("rejects an unknown subcommand", async () => {
    await expect(hookCommand(["frobnicate"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
