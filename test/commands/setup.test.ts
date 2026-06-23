import { describe, expect, it } from "vitest";
import { setupCommand, SETUP_HELP } from "../../src/commands/setup.js";

// The actual hook write is covered by test/harvest/hooks.test.ts (SDK
// integration with an explicit homeDir). Here we only assert the command
// surface: --help and the validation guard, neither of which touches ~/.claude.

describe("setup command", () => {
  it("returns help for `setup hooks --help`", async () => {
    expect(await setupCommand(["hooks", "--help"])).toBe(SETUP_HELP);
  });

  it("returns help for bare `setup --help`", async () => {
    expect(await setupCommand(["--help"])).toBe(SETUP_HELP);
  });

  it("rejects an unknown setup action", async () => {
    await expect(setupCommand(["frobnicate"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a missing setup action", async () => {
    await expect(setupCommand([])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
