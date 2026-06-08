import { harvestRequest, type QueryValue } from "./client.js";

/** Shape of a Harvest paginated list response. */
interface HarvestPage<T> {
  per_page: number;
  total_pages: number;
  total_entries: number;
  page: number;
  links?: { next?: string | null };
  [key: string]: unknown;
}

export interface PaginateResult<T> {
  items: T[];
  total_entries: number;
  /** True when every page was fetched and the count matches total_entries. */
  complete: boolean;
  pages_fetched: number;
}

/**
 * Paginate a Harvest list endpoint to completion by following `page` until
 * `total_pages` is reached. Per the paginate-to-completion principle, the
 * result carries an explicit `complete` flag and the authoritative
 * `total_entries` so callers never silently under-report.
 *
 * `key` is the array field name in the response (e.g. "time_entries").
 * `maxPages` is a safety backstop; when hit, `complete` is false.
 */
export async function paginateAll<T = Record<string, unknown>>(
  path: string,
  key: string,
  query: Record<string, QueryValue> = {},
  maxPages = 100,
): Promise<PaginateResult<T>> {
  const items: T[] = [];
  let page = 1;
  let totalEntries = 0;
  let totalPages = 1;

  for (; page <= totalPages && page <= maxPages; page++) {
    const res = await harvestRequest<HarvestPage<T>>(path, {
      query: { ...query, page, per_page: 2000 },
    });
    totalEntries = res.total_entries ?? totalEntries;
    totalPages = res.total_pages ?? 1;
    const pageItems = (res[key] as T[]) ?? [];
    items.push(...pageItems);
    if (!res.links?.next) break;
  }

  const pagesFetched = Math.min(page, totalPages, maxPages);
  const complete = items.length === totalEntries;

  return {
    items,
    total_entries: totalEntries,
    complete,
    pages_fetched: pagesFetched,
  };
}
