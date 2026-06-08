---
status: planned
depends: [review]
specs: []
issues: []
---

# Plan: Reports — analytics via the Reports API

## Scope

**In:** higher-level analytics built on Harvest's [Reports API](https://help.getharvest.com/api-v2/reports-api/reports/time-reports/) — time totals by project / client / team / task over a period, billable-vs-non-billable rollups, and budget/uninvoiced views that the per-entry `review` rollup can't cheaply compute. **Out:** the per-entry period review (that's `review`).

## Spec-first gate

This plan has **no specs yet**. Per the SpecOps spec-first rule, before implementation begins this plan must first land (as their own PR):

- `specs/api/reports.md` — the Reports API endpoints + response shapes + the 100-req/15-min rate limit.
- `specs/commands/reports.md` — the `reports` command surface, default schemas, and how it differs from / complements `review`.

Until those exist, `specs:` stays empty and this plan stays `planned`. The drift auditor only checks listed specs, so an empty list here is correct, not a gap.

## Implements

(To be filled once the specs above are authored.)

## Approach

1. Author the two specs above (separate PR).
2. `src/commands/reports.ts` consuming the Reports endpoints, reusing `parseRange` and the output helpers.
3. Respect the tighter Reports rate limit — surface remaining-budget awareness and back off on 429.

## Validation

- [ ] `specs/api/reports.md` and `specs/commands/reports.md` authored and accepted (gate).
- [ ] `reports` produces project/client/team time totals matching a `review` cross-check for the same window.
- [ ] Reports-API 429s are honored (Retry-After) without leaking raw errors.

## Risks / unknowns

- **Reports rate limit (100 / 15 min)** — far tighter than standard; a chatty agent could exhaust it. Design for few, wide calls.
- **Overlap with `review`** — keep the boundary crisp so the two don't become redundant; the specs must settle this.

## Notes

## Follow-ups
