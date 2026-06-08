import { describe, expect, it } from "vitest";
import {
  field,
  pluck,
  truncated,
  renderList,
  renderListResponse,
} from "../../src/output/index.js";

describe("output helpers", () => {
  it("renders a TOON table with a field schema", () => {
    const out = renderList(
      "entries",
      [
        { id: 1, project: { name: "Acme" }, hours: 2.5 },
        { id: 2, project: { name: "Beta" }, hours: 1 },
      ],
      [field("id"), pluck("project", "name", "project"), field("hours")],
    );
    expect(out).toContain("entries[2]{id,project,hours}:");
    expect(out).toContain("Acme");
    expect(out).toContain("2.5");
  });

  it("truncates long strings with an ellipsis", () => {
    const out = renderList(
      "rows",
      [{ notes: "x".repeat(50) }],
      [truncated("notes", 10)],
    );
    expect(out).toContain("…");
    expect(out).not.toContain("x".repeat(50));
  });

  it("emits a definitive empty state when items is empty", () => {
    const out = renderListResponse({
      name: "entries",
      items: [],
      schema: [field("id")],
      emptyMessage: "0 entries found in 2026-06-01 → 2026-06-07 for you",
    });
    expect(out).toContain("0 entries found");
    expect(out).not.toContain("entries[0]");
  });

  it("composes header, summary, list, and suggestions", () => {
    const out = renderListResponse({
      header: { scope: "you" },
      summary: { totals: "5h", complete: true },
      name: "entries",
      items: [{ id: 7 }],
      schema: [field("id")],
      suggestions: ["Run `harvest-axi review --by project` to regroup"],
    });
    expect(out).toContain("scope: you");
    expect(out).toContain("complete: true");
    expect(out).toContain("entries[1]{id}:");
    expect(out).toContain("help[1]:");
  });
});
