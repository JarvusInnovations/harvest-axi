# harvest-axi specs

These specs declare the **desired state** of harvest-axi. Implementation follows spec — the spec leads, the code conforms. See the [SpecOps workflow](https://agentskills.io) for the methodology.

## Layout

```
specs/
├── README.md            # this file
├── principles.md        # project-wide decisive rules (the philosophy)
├── architecture.md      # stack, structure, build, config
├── api/                 # the Harvest API v2 contract we consume
│   ├── conventions.md    # auth headers, base URL, pagination, rate limits, dates
│   ├── time-entries.md   # the time_entries endpoints (list/create/update/delete/timer)
│   └── reports.md        # the time reports endpoints (server-aggregated totals + $)
├── behaviors/           # cross-cutting rules spanning multiple commands
│   ├── date-ranges.md    # human time in, year-stamped range out
│   └── period-review.md  # the headline: review entries over a period × scope
└── commands/            # one file per top-level command surface
    ├── home.md           # no-args ambient view
    ├── auth.md           # PAT setup, doctor, whoami
    ├── review.md         # period-based review (the centerpiece)
    ├── entries.md        # entry read (get) + write (create/edit/delete/timer)
    ├── browse.md         # clients, projects, my assignments, tasks
    └── reports.md        # server-aggregated totals + billable $ (clients/projects/tasks/team)
```

## Conventions

- Specs declare **what** must be true, not **how** to build it.
- Every command spec lists its default TOON schema (the minimal column set), its flags, and its contextual-disclosure suggestions.
- When code and spec diverge, the spec is right and the code is a bug — fix the spec first if the spec is wrong.
- Work-in-flight is tracked in [`../plans/`](../plans/); each plan names the specs it implements.
