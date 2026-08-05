/**
 * Shared argument handling.
 *
 * Implements specs/behaviors/flag-validation.md: unknown flags and stray
 * positionals fail loud (exit 2) with the command's valid flags inline, and
 * renamed/removed flags get a targeted migration hint instead of the generic
 * list. Every command parses through here before any Harvest call.
 */
import { AxiError } from "axi-sdk-js";

/**
 * `--help` is the only universally-*accepted* flag.
 *
 * The export flags below are *recognized* everywhere — they're real flags, so
 * they never read as a typo — but they are only *supported* on the surfaces in
 * specs/behaviors/machine-output.md. Elsewhere they get a targeted redirect via
 * `rejectInertExportFlag`. Recognized-everywhere and allowed-everywhere are
 * different things, and conflating them in the help text is #19.
 */
export const EXPORT_FLAG_NAMES = ["--json-out", "--csv-out"] as const;

const OUT_FLAG_FORMATS: Record<string, "json" | "csv"> = {
  "--json-out": "json",
  "--csv-out": "csv",
};

/** Commands that actually write an export file, for the inert-flag message. */
const EXPORT_SURFACES = "`entries list`, `entries today|yesterday|get`, `invoices`";

/**
 * Flags renamed with no alias. The old name fails loud but gets a targeted
 * migration message rather than the generic valid-flags list, so an agent
 * self-corrects in one step.
 */
const RENAMED_FLAG_HINTS: Record<string, string> = {
  "--json":
    "--json was replaced by --json-out[=path], which writes the full payload to a file additively — stdout keeps the normal TOON view",
};

/**
 * Flags removed outright, mapped to what replaces them.
 *
 * `--raw` claimed to dump untranslated JSON but rendered TOON through the
 * normal object renderer, so nothing could parse it.
 */
const REMOVED_FLAG_HINTS: Record<string, string> = {
  "--raw":
    "--raw was replaced by --json-out[=path] — it advertised JSON but rendered TOON, so nothing could parse it. --json-out writes real JSON to a file; stdout keeps the normal detail view",
};

/** Flags whose value is optional and, when given, must be attached with `=`. */
const OPTIONAL_VALUE_FLAGS = new Set(["--json-out", "--csv-out"]);

/**
 * Expand `--name=value` into separate tokens so the switch-based parsers can
 * match on `--name`.
 *
 * Optional-value flags are left intact: splitting `--json-out=path` here would
 * make it indistinguishable from `--json-out path`, and the space-separated
 * form must stay invalid so it can't swallow a positional (`entries get <id>`).
 * Those are stripped upstream by `parseExportRequest`.
 */
export function normalizeArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      out.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq < 0) {
      out.push(arg);
      continue;
    }
    const name = arg.slice(0, eq);
    if (OPTIONAL_VALUE_FLAGS.has(name)) {
      out.push(arg);
      continue;
    }
    out.push(name, arg.slice(eq + 1));
  }
  return out;
}

/** The flag's name, with any `=value` stripped. `--json-out=/x` → `--json-out`. */
export function flagName(token: string): string {
  const eq = token.indexOf("=");
  return eq < 0 ? token : token.slice(0, eq);
}

/**
 * Reject an unrecognized flag.
 *
 * Classification happens on the flag **name**, never the raw token: `--json-out`
 * and `--json-out=/tmp/x.json` are the same flag and must take the same branch.
 * Testing the raw token routed the attached-value form to the generic path,
 * which is how #19 reached users.
 *
 * This is the single funnel every unknown flag reaches, so export-flag and
 * renamed/removed classification lives here rather than at each call site —
 * nine copies of that check is what let the two forms drift apart.
 *
 * Per AXI §6 the error is self-correcting in one turn: it names the flag and
 * lists the valid ones inline, so the agent never needs a follow-up `--help`.
 */
export function rejectUnknownFlag(
  flag: string,
  known: readonly string[],
  command: string,
  opts: { exports?: boolean } = {},
): never {
  const name = flagName(flag);

  // Real flags with a real meaning, just not supported here — a redirect, not
  // an "unknown flag". Export-capable commands strip these before parsing, so
  // reaching this branch means the command genuinely doesn't export.
  if (name in OUT_FLAG_FORMATS) rejectInertExportFlag(name, command);

  const renamed = RENAMED_FLAG_HINTS[name];
  if (renamed) {
    throw new AxiError(renamed, "VALIDATION_ERROR", [`\`${command}\` does not accept ${name}`]);
  }
  const removed = REMOVED_FLAG_HINTS[name];
  if (removed) {
    throw new AxiError(removed, "VALIDATION_ERROR", [`\`${command}\` no longer accepts ${name}`]);
  }

  const suggestions: string[] = [];
  if (known.length) suggestions.push(`Valid flags for \`${command}\`: ${known.join(", ")}`);
  // Only claim what this command actually accepts. A suggestion naming a flag
  // the same command rejects is worse than none — the agent believes it and
  // retries (#19).
  suggestions.push(
    opts.exports
      ? "--help is always allowed; this command also accepts --json-out[=path] and --csv-out[=path]"
      : "--help is always allowed",
  );
  throw new AxiError(`Unknown flag ${name} for \`${command}\``, "VALIDATION_ERROR", suggestions);
}

/** Reject a stray positional — a dropped argument is as silent as a dropped flag. */
export function rejectUnknownPositional(value: string, command: string, usage: string): never {
  throw new AxiError(`Unexpected argument "${value}" for \`${command}\``, "VALIDATION_ERROR", [
    usage,
  ]);
}

/**
 * Reject an export flag on a command that doesn't export. Called by commands
 * outside machine-output.md's Applies-To table.
 */
export function rejectInertExportFlag(flag: string, command: string): never {
  throw new AxiError(`${flag} is not supported on \`${command}\``, "VALIDATION_ERROR", [
    `Machine output is available on ${EXPORT_SURFACES}`,
    "Run `harvest-axi entries list --json-out` to export entries for a script",
  ]);
}

/**
 * Reject two flags whose meanings contradict each other. Silently letting one
 * win produces plausible-looking wrong output, which is strictly worse than an
 * error — see specs/principles.md#fail-loud-on-unrecognized-input.
 */
export function rejectContradiction(
  a: string,
  b: string,
  command: string,
  alternatives: string[],
): never {
  throw new AxiError(
    `${a} and ${b} contradict each other on \`${command}\``,
    "VALIDATION_ERROR",
    alternatives,
  );
}
