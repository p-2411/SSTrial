/**
 * How the API's lists are searched and paged: the limits its query schemas enforce (requests.ts)
 * and its error messages state. Zod-free, so the web app can import it.
 */

/** Longest search a list takes, in characters. */
export const MAX_SEARCH_LENGTH = 200;

/** How many rows a page of each list holds unless the request asks for another number, and the most it may ask for. */
export const PAGE_SIZES = {
  /** GET /api/uploads */
  uploads: { default: 50, max: 100 },
  /** GET /api/logs */
  logs: { default: 50, max: 200 },
  /** GET /api/uploads/:id/history */
  history: { default: 20, max: 200 },
} as const satisfies Record<string, { default: number; max: number }>;
