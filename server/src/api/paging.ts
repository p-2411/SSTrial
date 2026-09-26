import { LOG_EVENT_TYPE_IDS, MAX_SEARCH_LENGTH } from '@label-extractor/shared';

/**
 * How the API's lists are narrowed and paged, the same for each: the upload lists, the activity
 * log and each upload's history. Every list is read a page at a time, newest first, and asked for
 * one row more than the page holds (`limit + 1`): if that row comes back, there's another page.
 */

/** The page of rows to send, and the cursor for the next page (from the last row sent), if there is one. */
export function pageOf<T>(rows: T[], limit: number, cursorOf: (row: T) => string): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  return { page, nextCursor: rows.length > limit ? cursorOf(page.at(-1)!) : null };
}

/** Words to find and a span of time, as a query gives them (see requests.ts). */
export interface WordsAndTimeQuery {
  q?: string;
  from?: string;
  to?: string;
}

/** The same, as the stores take them: blank words find everything, and the instants are Dates. */
export interface WordsAndTime {
  search?: string;
  /** At or after. */
  from?: Date;
  /** Before. */
  to?: Date;
}

export function wordsAndTime({ q, from, to }: WordsAndTimeQuery): WordsAndTime {
  return { search: q || undefined, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined };
}

/** The activity log's query parameters, as the log and each upload's history both take them. */
export const ACTIVITY_QUERY_HELP = `Use q=words to find (up to ${MAX_SEARCH_LENGTH} characters), type=… once per type wanted (${LOG_EVENT_TYPE_IDS.join(', ')}), from= and to= as ISO date-times, and a cursor from a previous page`;
