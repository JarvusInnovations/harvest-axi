import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSessionStartHooks } from "axi-sdk-js";

// Validates harvest-axi's reliance on the SDK hook primitive: a dist/bin/
// harvest-axi.js exec path installs a SessionStart hook referencing the binary,
// is idempotent, and repairs the command when the exec path changes. Uses an
// explicit homeDir so no real ~/.claude or $HOME is touched.

let home: string;
const claudeSettings = () => join(home, ".claude", "settings.json");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "harvest-axi-home-"));
});
afterEach(() => {
  /* tmp dirs are disposable */
});

function install(execPath: string) {
  installSessionStartHooks({ homeDir: home, execPath });
}

describe("session hook install (SDK integration)", () => {
  it("writes a SessionStart hook referencing harvest-axi", () => {
    install("/opt/app/dist/bin/harvest-axi.js");
    const settings = JSON.parse(readFileSync(claudeSettings(), "utf-8"));
    expect(settings.hooks?.SessionStart).toBeTruthy();
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("harvest-axi");
  });

  it("is idempotent: a second identical install does not change the file", () => {
    install("/opt/app/dist/bin/harvest-axi.js");
    const first = readFileSync(claudeSettings(), "utf-8");
    install("/opt/app/dist/bin/harvest-axi.js");
    expect(readFileSync(claudeSettings(), "utf-8")).toBe(first);
  });

  it("repairs the command when the exec path changes", () => {
    install("/opt/old/dist/bin/harvest-axi.js");
    const before = readFileSync(claudeSettings(), "utf-8");
    install("/opt/new/dist/bin/harvest-axi.js");
    const after = readFileSync(claudeSettings(), "utf-8");
    expect(after).not.toBe(before);
    expect(after).toContain("/opt/new/");
  });
});
