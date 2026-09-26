import { useSearchParams } from 'react-router';
import type { NavigateOptions } from 'react-router';
import { MAX_SEARCH_LENGTH } from '@/components/SearchInput';
import { LOG_EVENT_TYPE_IDS, LOG_EVENT_TYPES, type LogEventType } from '@label-extractor/shared';
import { logFilterParams, type LogFilters } from '@/api/logs';

/**
 * The activity log's filters live in the URL (?q=oat+milk&type=extraction.failed&type=…&upload=…),
 * so they survive refreshes and can be shared. Values that aren't valid are dropped rather than
 * sent to the server.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const NO_LOG_FILTERS: LogFilters = { search: '', types: [], upload: null };

export function readLogFilters(params: URLSearchParams): LogFilters {
  const upload = params.get('upload');
  return {
    search: (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    types: inCatalogueOrder(params.getAll('type')),
    upload: upload !== null && UUID.test(upload) ? upload : null,
  };
}

/**
 * Known types only, once each, in the catalogue's order, so the same choice always makes the same
 * URL (and the same cached query) however it was ticked.
 */
export function inCatalogueOrder(types: readonly string[]): LogEventType[] {
  return LOG_EVENT_TYPE_IDS.filter((type) => types.includes(type));
}

/**
 * The filters in the URL, and a function that changes some of them: a navigation, so Back undoes
 * it (unless `replace`, as for a search being typed). Changes apply to the URL as it is then, so a
 * change made after a pause can't undo one made meanwhile.
 */
export function useLogFilters(): [LogFilters, (changes: Partial<LogFilters>, options?: NavigateOptions) => void] {
  const [params, setParams] = useSearchParams();
  return [
    readLogFilters(params),
    (changes, options) => setParams((current) => logFilterParams({ ...readLogFilters(current), ...changes }), options),
  ];
}

/*
 * The "Show" menu's model (LogFilterBar draws it): its sections of event types, the shortcuts at
 * its top, and how a choice is summed up on its button.
 */

/** Which heading each type sits under in the menu. Keyed by type, so a new one needs a place here. */
const TYPE_GROUP = {
  'upload.created': 'Uploads',
  'upload.duplicate': 'Uploads',
  'upload.queued': 'Uploads',
  'upload.rejected': 'Uploads',
  'upload.discarded': 'Uploads',
  'upload.retry_requested': 'Uploads',
  'upload.edited': 'Uploads',
  'upload.reverted': 'Uploads',
  'upload.submitted': 'Uploads',
  'upload.deleted': 'Uploads',
  'extraction.started': 'Extraction',
  'extraction.completed': 'Extraction',
  'extraction.retry_scheduled': 'Extraction',
  'extraction.failed': 'Extraction',
  'extraction.abandoned': 'Extraction',
  'ratelimit.paused': 'Extraction',
  'process.started': 'System',
} satisfies Record<LogEventType, string>;

/** The menu's sections of event types, in shared's order. */
export const TYPE_MENU: Array<{ heading: string; types: LogEventType[] }> = [];
for (const type of LOG_EVENT_TYPE_IDS) {
  const heading = TYPE_GROUP[type];
  const section = TYPE_MENU.find((candidate) => candidate.heading === heading);
  if (section) section.types.push(type);
  else TYPE_MENU.push({ heading, types: [type] });
}

/**
 * Choices at the top of the menu, each a whole set of types. A type always has the same level, so
 * "warnings and errors" is just the types that are warnings or errors. Everything is no filter.
 */
export const SHORTCUTS: Array<{ label: string; types: LogEventType[] }> = [
  { label: 'Everything', types: [] },
  { label: 'Warnings and errors', types: LOG_EVENT_TYPE_IDS.filter((type) => LOG_EVENT_TYPES[type].level !== 'info') },
  { label: 'Errors only', types: LOG_EVENT_TYPE_IDS.filter((type) => LOG_EVENT_TYPES[type].level === 'error') },
];

/** Both lists are in the catalogue's order, so comparing them in order is enough. */
export function sameTypes(a: LogEventType[], b: LogEventType[]): boolean {
  return a.length === b.length && a.every((type, i) => type === b[i]);
}

/** The menu button's summary of the choice, after "Show": "everything", "errors only", "3 types of event"… */
export function describeFilter(types: LogEventType[]): string {
  const shortcut = SHORTCUTS.find((candidate) => sameTypes(candidate.types, types));
  if (shortcut) return midSentence(shortcut.label);
  if (types.length === 1) return midSentence(LOG_EVENT_TYPES[types[0]!].label);
  return `${types.length} types of event`;
}

/** A label as it reads after "Show": "Errors only" → "errors only", but "AI requests paused" stays. */
function midSentence(label: string): string {
  const firstWord = label.split(' ')[0]!;
  return firstWord === firstWord.toUpperCase() ? label : label.charAt(0).toLowerCase() + label.slice(1);
}
