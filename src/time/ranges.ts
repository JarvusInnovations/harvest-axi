import { AxiError } from "axi-sdk-js";

export interface ResolvedRange {
  /** Harvest `from` date, YYYY-MM-DD. */
  from: string;
  /** Harvest `to` date, YYYY-MM-DD. */
  to: string;
  /** Year-stamped, human-readable label for the output header. */
  label: string;
}

export interface RangeFlags {
  from?: string;
  to?: string;
  since?: string;
  /** A named window flag, e.g. "today", "this-week". */
  named?: string;
}

const NAMED_WINDOWS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
] as const;

export type NamedWindow = (typeof NAMED_WINDOWS)[number];

const ACCEPTED_FORMS = [
  "--from <date> --to <date> (YYYY-MM-DD, MM-DD, or M/D)",
  "--since <dur> (e.g. 7d, 2w, 1m)",
  `named: ${NAMED_WINDOWS.join(", ")}`,
];

function validationError(msg: string): AxiError {
  return new AxiError(msg, "VALIDATION_ERROR", [
    `Accepted forms: ${ACCEPTED_FORMS.join(" | ")}`,
  ]);
}

// Local-date helpers — Harvest spent_date is a calendar date, no tz math. ──
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Monday of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // 0=Sun → 6, 1=Mon → 0, ...
  return addDays(d, -offset);
}

/** Parse a bare date: YYYY-MM-DD, MM-DD, or M/D (current year assumed). */
function parseDate(input: string, now: Date): Date | null {
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const md = input.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (md) {
    return new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2]));
  }
  return null;
}

/** Parse a duration like 7d / 2w / 1m into a `from` date relative to `now`. */
function parseSince(since: string, now: Date): Date | null {
  const m = since.match(/^(\d+)([dwm])$/);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "d":
      return addDays(now, -n);
    case "w":
      return addDays(now, -n * 7);
    case "m": {
      const r = new Date(now);
      r.setMonth(r.getMonth() - n);
      return r;
    }
    default:
      return null;
  }
}

function resolveNamed(named: string, now: Date): ResolvedRange {
  const today = fmt(now);
  switch (named as NamedWindow) {
    case "today":
      return { from: today, to: today, label: `${today} (today)` };
    case "yesterday": {
      const y = fmt(addDays(now, -1));
      return { from: y, to: y, label: `${y} (yesterday)` };
    }
    case "this-week": {
      const mon = startOfWeek(now);
      const sun = addDays(mon, 6);
      return { from: fmt(mon), to: fmt(sun), label: `${fmt(mon)} → ${fmt(sun)} (this-week)` };
    }
    case "last-week": {
      const mon = addDays(startOfWeek(now), -7);
      const sun = addDays(mon, 6);
      return { from: fmt(mon), to: fmt(sun), label: `${fmt(mon)} → ${fmt(sun)} (last-week)` };
    }
    case "this-month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: fmt(first), to: fmt(last), label: `${fmt(first)} → ${fmt(last)} (this-month)` };
    }
    case "last-month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(first), to: fmt(last), label: `${fmt(first)} → ${fmt(last)} (last-month)` };
    }
    default:
      throw validationError(`Unknown named window: ${named}`);
  }
}

/**
 * Resolve human date-range input into Harvest from/to dates plus a year-stamped
 * label. Precedence: explicit --from/--to, then named window, then --since,
 * then the command's default. Unparseable input throws VALIDATION_ERROR rather
 * than silently falling back, so a wrong window is always visible.
 */
export function parseRange(
  flags: RangeFlags,
  opts: { defaultSince?: string; defaultNamed?: NamedWindow } = {},
  now: Date = new Date(),
): ResolvedRange {
  // Explicit bounds win.
  if (flags.from || flags.to) {
    const toDate = flags.to ? parseDate(flags.to, now) : now;
    const fromDate = flags.from ? parseDate(flags.from, now) : null;
    if (flags.from && !fromDate) throw validationError(`Could not parse --from "${flags.from}"`);
    if (flags.to && !toDate) throw validationError(`Could not parse --to "${flags.to}"`);
    const from = fromDate ? fmt(fromDate) : fmt(now);
    const to = toDate ? fmt(toDate) : fmt(now);
    return { from, to, label: `${from} → ${to}` };
  }

  if (flags.named) return resolveNamed(flags.named, now);

  if (flags.since) {
    const fromDate = parseSince(flags.since, now);
    if (!fromDate) throw validationError(`Could not parse --since "${flags.since}"`);
    const from = fmt(fromDate);
    const to = fmt(now);
    return { from, to, label: `${from} → ${to} (last ${flags.since})` };
  }

  // Command default.
  if (opts.defaultNamed) return resolveNamed(opts.defaultNamed, now);
  if (opts.defaultSince) {
    const fromDate = parseSince(opts.defaultSince, now)!;
    const from = fmt(fromDate);
    const to = fmt(now);
    return { from, to, label: `${from} → ${to} (last ${opts.defaultSince})` };
  }

  // No input and no default → today.
  const today = fmt(now);
  return { from: today, to: today, label: `${today} (today)` };
}

export { NAMED_WINDOWS };
