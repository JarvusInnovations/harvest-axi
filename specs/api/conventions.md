# API: Harvest v2 conventions

The contract harvest-axi consumes. Source: <https://help.getharvest.com/api-v2/>.

## Base URL

`https://api.harvestapp.com/v2/` — every endpoint path is relative to this.

## Auth headers (every request)

1. `Authorization: Bearer <personal-access-token>`
2. `Harvest-Account-Id: <account-id>`
3. `User-Agent: harvest-axi (<contact>)` — **required**; omitting it returns `400`. Use a fixed app name plus a contact URL/email.

Personal Access Tokens are created at <https://id.getharvest.com/developers>. A token can see multiple accounts; the `Harvest-Account-Id` header selects which one.

## Request formatting

- GET: parameters in the query string.
- POST/PATCH: JSON body with `Content-Type: application/json`.
- Methods used: GET, POST, PATCH, DELETE.

## Pagination

List responses wrap results in a named array plus metadata:

```json
{
  "time_entries": [ ... ],
  "per_page": 2000,
  "total_pages": 3,
  "total_entries": 4512,
  "page": 1,
  "links": { "first": "...", "next": "...", "previous": null, "last": "..." }
}
```

- `per_page` ranges 1–2000 (default 2000).
- Paginate by following `links.next` until it is null (or `page > total_pages`).
- `total_entries` is the authoritative count — surface it so callers know completeness without re-paginating.

## Rate limits

- **Standard endpoints:** 100 requests / 15 seconds.
- **Reports API:** 100 requests / 15 minutes (much tighter — review built on reports must respect it).
- `429` responses carry a `Retry-After` header (seconds). Honor it.

## Dates & times

- `date`: `YYYY-MM-DD` (e.g. `2026-06-07`).
- `datetime`: ISO 8601 UTC (e.g. `2026-06-07T14:59:22Z`).
- `time`: account-dependent 12h/24h string (e.g. `8:00am`).

## Notes

- `updated_since` (ISO 8601 datetime) enables incremental sync on most list endpoints — useful for "what changed since my last review."
- Idempotency: PATCH only changes supplied fields; unspecified fields are untouched.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — the 401/403/404/422/429/5xx envelope below maps to AxiError codes.
- [Token-based auth, unattended-friendly](../principles.md#token-based-auth-unattended-friendly) — the three static headers above are the whole auth story.

## Error mapping

The client translates Harvest HTTP errors into `AxiError`s (raw bodies never reach stdout):

| HTTP | AxiError code | Suggestion references |
|------|---------------|-----------------------|
| 401 | `TOKEN_INVALID` | `harvest-axi auth setup` |
| 403 | `FORBIDDEN` | scope/role note |
| 404 | `NOT_FOUND` | the relevant list command to find valid ids |
| 422 | `VALIDATION_ERROR` | the field(s) Harvest rejected |
| 429 | `RATE_LIMITED` | retry after `Retry-After` seconds |
| ≥500 | `SERVER_ERROR` | retry after a moment |
