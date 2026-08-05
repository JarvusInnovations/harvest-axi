import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  normalizeArgs,
  rejectContradiction,
  rejectInertExportFlag,
  rejectUnknownFlag,
  rejectUnknownPositional,
} from "../../src/cli/args.js";

/** Run `fn`, returning the AxiError it threw (or failing the test). */
function caught(fn: () => unknown): AxiError {
  try {
    fn();
  } catch (e) {
    return e as AxiError;
  }
  throw new Error("expected a throw");
}

describe("normalizeArgs", () => {
  it("splits --name=value into separate tokens", () => {
    expect(normalizeArgs(["--project=Acme", "--limit=5"])).toEqual([
      "--project",
      "Acme",
      "--limit",
      "5",
    ]);
  });

  it("leaves plain flags and positionals untouched", () => {
    expect(normalizeArgs(["--team", "123", "--by", "user"])).toEqual([
      "--team",
      "123",
      "--by",
      "user",
    ]);
  });

  it("keeps a value containing '=' intact after the first split", () => {
    expect(normalizeArgs(["--notes=a=b"])).toEqual(["--notes", "a=b"]);
  });

  it("leaves export flags intact so the =form stays distinguishable", () => {
    // Splitting these would make `--json-out=path` look like `--json-out path`,
    // and the space form must stay invalid so it can't swallow a positional.
    expect(normalizeArgs(["--json-out=/tmp/x.json"])).toEqual(["--json-out=/tmp/x.json"]);
    expect(normalizeArgs(["--csv-out"])).toEqual(["--csv-out"]);
  });
});

describe("rejectUnknownFlag", () => {
  it("names the flag and lists valid flags inline for one-turn correction", () => {
    const err = caught(() => rejectUnknownFlag("--stat", ["--state", "--limit"], "invoices"));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("--stat");
    expect(err.message).toContain("invoices");
    expect(err.suggestions?.join(" ")).toContain("--state, --limit");
  });

  it("always mentions the globals", () => {
    const err = caught(() => rejectUnknownFlag("--nope", [], "review"));
    expect(err.suggestions?.join(" ")).toContain("--json-out");
  });

  it("gives --raw a targeted migration hint, not the generic list", () => {
    const err = caught(() => rejectUnknownFlag("--raw", ["--state"], "invoices get"));
    expect(err.message).toContain("--json-out");
    expect(err.message).toContain("advertised JSON but rendered TOON");
    expect(err.suggestions?.join(" ")).not.toContain("--state");
  });

  it("gives --json a targeted migration hint", () => {
    const err = caught(() => rejectUnknownFlag("--json", ["--state"], "invoices"));
    expect(err.message).toContain("--json-out[=path]");
    expect(err.suggestions?.join(" ")).not.toContain("--state");
  });
});

describe("rejectUnknownPositional", () => {
  it("names the stray argument", () => {
    const err = caught(() => rejectUnknownPositional("bogus", "review", "run --help"));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain('"bogus"');
    expect(err.suggestions).toEqual(["run --help"]);
  });
});

describe("rejectInertExportFlag", () => {
  it("points at the commands that actually export", () => {
    const err = caught(() => rejectInertExportFlag("--json-out", "review"));
    expect(err.message).toContain("not supported on `review`");
    expect(err.suggestions?.join(" ")).toContain("entries list");
  });
});

describe("rejectContradiction", () => {
  it("names both flags and carries the alternatives", () => {
    const err = caught(() =>
      rejectContradiction("--team", "--user", "review", ["use --user alone"]),
    );
    expect(err.message).toContain("--team");
    expect(err.message).toContain("--user");
    expect(err.suggestions).toEqual(["use --user alone"]);
  });
});
