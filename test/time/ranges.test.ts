import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/time/ranges.js";

// Fixed reference: Wednesday, 2026-06-10.
const NOW = new Date(2026, 5, 10);

describe("parseRange", () => {
  it("resolves --since 7d to a year-stamped range ending today", () => {
    const r = parseRange({ since: "7d" }, {}, NOW);
    expect(r.from).toBe("2026-06-03");
    expect(r.to).toBe("2026-06-10");
    expect(r.label).toContain("2026");
    expect(r.label).toContain("last 7d");
  });

  it("resolves --since 2w", () => {
    const r = parseRange({ since: "2w" }, {}, NOW);
    expect(r.from).toBe("2026-05-27");
    expect(r.to).toBe("2026-06-10");
  });

  it("resolves --since 1m via calendar month", () => {
    const r = parseRange({ since: "1m" }, {}, NOW);
    expect(r.from).toBe("2026-05-10");
  });

  it("resolves this-week as Monday → Sunday", () => {
    const r = parseRange({ named: "this-week" }, {}, NOW);
    expect(r.from).toBe("2026-06-08"); // Monday
    expect(r.to).toBe("2026-06-14"); // Sunday
    expect(r.label).toContain("(this-week)");
  });

  it("resolves last-week", () => {
    const r = parseRange({ named: "last-week" }, {}, NOW);
    expect(r.from).toBe("2026-06-01");
    expect(r.to).toBe("2026-06-07");
  });

  it("resolves this-month and last-month bounds", () => {
    expect(parseRange({ named: "this-month" }, {}, NOW)).toMatchObject({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(parseRange({ named: "last-month" }, {}, NOW)).toMatchObject({
      from: "2026-05-01",
      to: "2026-05-31",
    });
  });

  it("resolves today and yesterday", () => {
    expect(parseRange({ named: "today" }, {}, NOW).from).toBe("2026-06-10");
    expect(parseRange({ named: "yesterday" }, {}, NOW).from).toBe("2026-06-09");
  });

  it("honors explicit --from/--to over everything", () => {
    const r = parseRange({ from: "2026-01-01", to: "2026-03-31", since: "7d" }, {}, NOW);
    expect(r.from).toBe("2026-01-01");
    expect(r.to).toBe("2026-03-31");
  });

  it("accepts MM-DD and M/D bare dates in the current year", () => {
    expect(parseRange({ from: "01-15", to: "02-20" }, {}, NOW)).toMatchObject({
      from: "2026-01-15",
      to: "2026-02-20",
    });
    expect(parseRange({ from: "3/5" }, {}, NOW).from).toBe("2026-03-05");
  });

  it("applies the command default when no input is given", () => {
    const r = parseRange({}, { defaultSince: "7d" }, NOW);
    expect(r.from).toBe("2026-06-03");
    expect(r.to).toBe("2026-06-10");
  });

  it("throws VALIDATION_ERROR on unparseable input rather than falling back", () => {
    expect(() => parseRange({ since: "soon" }, {}, NOW)).toThrowError(/parse --since/);
    expect(() => parseRange({ from: "not-a-date" }, {}, NOW)).toThrowError(/parse --from/);
  });
});
