/**
 * Side-channel machine output.
 *
 * Implements specs/behaviors/machine-output.md. stdout stays the agent's TOON
 * view, always; the full payload goes to a *file* only when an explicit
 * `--<fmt>-out` flag is passed. Writing a file never changes stdout beyond the
 * appended `wrote:`/`columns:`/`help[]` lines that describe it.
 *
 * Ported from the metabase-axi reference implementation (rationale in
 * kunchenguid/axi#32). There is deliberately no `--json`-to-stdout mode.
 */
import { AxiError } from "axi-sdk-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type ExportFormat = "json" | "csv";

const OUT_FLAGS: Record<string, ExportFormat> = {
  "--json-out": "json",
  "--csv-out": "csv",
};

/**
 * Does this token obviously name a file?
 *
 * Used only to improve the error when someone writes `--json-out <path>` (the
 * space form, which can't be supported — it would swallow a positional). The
 * test is deliberately narrow: `entries get --json-out 123` must NOT be
 * mistaken for a stray path, so a bare id never qualifies.
 */
function looksLikePath(token: string | undefined): boolean {
  if (!token || token.startsWith("-")) return false;
  return token.includes("/") || /\.(json|csv|tsv|pdf)$/i.test(token);
}

/**
 * Guard an optional-value flag against the space form.
 *
 * Shared by every `--<x>-out[=path]`-shaped flag rather than copied per call
 * site: duplicating this class of rule is what let the two `--json-out` forms
 * drift apart in #19.
 */
export function assertAttachedValueForm(
  flag: string,
  followingToken: string | undefined,
  autoDescription: string,
): void {
  if (!looksLikePath(followingToken)) return;
  throw new AxiError(`${flag} takes its path attached with \`=\``, "VALIDATION_ERROR", [
    `Use \`${flag}=${followingToken}\` to write there`,
    `Use \`${flag}\` bare to ${autoDescription}`,
  ]);
}

export interface ExportRequest {
  format: ExportFormat;
  /** Explicit path from `--<fmt>-out=<path>`; undefined means auto-generate. */
  path?: string;
}

export interface ParsedExportArgs {
  /** argv with the export flags removed, for the command's own parser. */
  rest: string[];
  request?: ExportRequest;
}

/**
 * Strip and parse the export flags from argv.
 *
 * Only the attached form (`--json-out=path`) supplies a path — a
 * space-separated value would swallow a positional (`entries get <id>`), so
 * the bare flag always means "auto-generate a path".
 */
export function parseExportRequest(args: string[]): ParsedExportArgs {
  const rest: string[] = [];
  const found: { flag: string; request: ExportRequest }[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg : arg.slice(0, eq);
    const format = OUT_FLAGS[name];
    if (!format) {
      rest.push(arg);
      continue;
    }
    // The space form can't be supported (it would swallow a positional), but
    // failing with a stray-positional error explains nothing — name the form
    // that works instead.
    if (eq < 0) {
      assertAttachedValueForm(name, args[i + 1], "auto-generate a path under the OS temp dir");
    }
    found.push({
      flag: name,
      request: { format, path: eq < 0 ? undefined : arg.slice(eq + 1) },
    });
  }

  if (found.length > 1) {
    throw new AxiError("Use at most one export flag per invocation", "VALIDATION_ERROR", [
      `Got: ${found.map((f) => f.flag).join(", ")}`,
      "Run the command twice if you need both formats",
    ]);
  }
  if (found.length === 1 && found[0].request.path === "") {
    throw new AxiError(`${found[0].flag}= requires a path after the \`=\``, "VALIDATION_ERROR", [
      `Use \`${found[0].flag}\` bare to auto-generate a path, or \`${found[0].flag}=<path>\``,
    ]);
  }

  return { rest, request: found[0]?.request };
}

function expandPath(path: string): string {
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

/**
 * Resolve the destination: the explicit path, or an auto path in the OS temp
 * dir.
 *
 * An auto-generated export is ephemeral scratch, so it belongs somewhere the
 * OS prunes — never under `~/.config/harvest-axi`, which nothing prunes and
 * which would grow unbounded. (metabase-axi shipped it under `~/.config`
 * first and had to correct it.)
 */
export function resolveExportPath(req: ExportRequest, kind: string): string {
  // `:` and `.` are not filesystem-safe on every platform.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolveOutPath(req.path, `${stamp}-${kind}.${req.format}`);
}

/**
 * Resolve an explicit destination (with `~` / relative expansion) or fall back
 * to `autoName` under the OS scratch dir. Shared so every file-writing flag
 * resolves paths identically.
 */
export function resolveOutPath(explicit: string | undefined, autoName: string): string {
  if (explicit) return expandPath(explicit);
  return join(tmpdir(), "harvest-axi", autoName);
}

function helpLineFor(format: ExportFormat, path: string, kind: string): string {
  if (format === "csv") {
    return `Run \`head ${path}\` (or open it in a spreadsheet) to use the full ${kind} export`;
  }
  return kind === "entries"
    ? `Run \`jq '[.entries[] | select(.billable)] | map(.rounded_hours) | add' ${path}\` to total billable hours`
    : `Run \`jq '[.invoices[] | .amount] | add' ${path}\` to total the exported invoices`;
}

export interface ExportOutcome {
  path: string;
  wrote: string;
  columns: string;
  helpLine: string;
}

/**
 * Write the export and describe it for stdout.
 *
 * `columns` is echoed inline so a follow-up `jq`/`csvkit` can be composed
 * without opening the file first — the detail that makes this pattern usable
 * for agents.
 */
export function performExport(
  req: ExportRequest,
  kind: string,
  data: string,
  meta: { rows: number; columns: string[] },
): ExportOutcome {
  const path = resolveExportPath(req, kind);
  mkdirSync(dirname(path), { recursive: true });
  // Auto-generated files land in a world-readable temp dir on some platforms
  // and carry billable_rate / cost_rate / client names → owner-only. An
  // explicit path is the caller's responsibility (default umask).
  const auto = !req.path;
  writeFileSync(path, data, auto ? { mode: 0o600 } : undefined);
  return {
    path,
    wrote: `${path} (${meta.rows} row${meta.rows === 1 ? "" : "s"})`,
    columns: meta.columns.join(", "),
    helpLine: helpLineFor(req.format, path, kind),
  };
}

/**
 * Flatten a record for CSV: a nested `{id, name}` entity becomes `<key>` (the
 * name) plus `<key>_id`, so a spreadsheet keeps the readable label and a script
 * keeps the stable id. Lossy by design — JSON is the round-trippable format.
 */
export function flattenRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entity = value as { id?: unknown; name?: unknown };
      out[key] = entity.name ?? "";
      out[`${key}_id`] = entity.id ?? "";
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Build and write an export from a record set.
 *
 * JSON nests under `kind` (`{"entries": [...]}`) so one `jq` idiom works for
 * every surface, including single-record ones. CSV gets the flattened form.
 */
export function buildExport(
  req: ExportRequest,
  kind: string,
  records: Record<string, unknown>[],
): ExportOutcome {
  if (req.format === "csv") {
    const flat = records.map(flattenRecord);
    const columns = flat.length ? Object.keys(flat[0]) : [];
    return performExport(req, kind, toCsv(flat, columns), {
      rows: flat.length,
      columns,
    });
  }
  const columns = records.length ? Object.keys(records[0]) : [];
  return performExport(req, kind, `${JSON.stringify({ [kind]: records }, null, 2)}\n`, {
    rows: records.length,
    columns,
  });
}

/** Serialize rows to CSV. Flat and lossy by nature — reporting, not round-trip. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(","));
  return `${lines.join("\n")}\n`;
}
