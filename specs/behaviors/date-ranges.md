# Behavior: Date ranges

## Rule

Any command that accepts a time window takes **human date input** and converts it internally to Harvest `from`/`to` dates. The resolved window is always **echoed back, year-stamped**, in the output header. The agent never computes a timestamp, and a wrong window is always visible.

## Applies To

`review`, `entries` list views, and any future report command.

## Input forms

- `--from <date> --to <date>` — explicit bounds (`--to` defaults to today if omitted; `--from` defaults per command).
- `--since <duration>` — relative lookback: `7d`, `2w`, `1m`, `90d`. `--since 7d` = last 7 days through today.
- Named windows: `today`, `yesterday`, `this-week`, `last-week`, `this-month`, `last-month`. Weeks are Mon–Sun unless the account preference says otherwise (default Monday).
- Bare dates accept `YYYY-MM-DD`; also accept `MM-DD` and `M/D` (current year assumed).

## Resolution & stamping

- All resolution is in the **account's local sense of "today"** (date-only; Harvest `spent_date` is a calendar date, no timezone math needed).
- The header line reports the resolved range in full ISO form with the year explicit:

```
range: 2026-06-01 → 2026-06-07 (this-week)
```

  The parenthetical echoes the input form when a named/relative form was used, so the agent can confirm intent.

- Ambiguous or unparseable input is a `VALIDATION_ERROR` listing the accepted forms — never a silent fallback to "today".

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Human time in, stamped range out](../principles.md#human-time-in-stamped-range-out) — this behavior is the operationalization of that principle.
