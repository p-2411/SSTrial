import { DATA_CHANGE_EVENT_TYPES, LOG_EVENT_TYPE_IDS, LOG_EVENT_TYPES, type LogEventType } from '@label-extractor/shared';

/*
 * The "Show" menu's model (TypeMenu draws it): its sections of event types, the shortcuts at its
 * top, and how a choice is summed up on its button. The activity log offers every type; a
 * product's history, only those an upload can have.
 */

/**
 * Known types only, once each, in the catalogue's order, so the same choice always makes the same
 * URL (and the same cached query) however it was ticked.
 */
export function inCatalogueOrder(types: readonly string[]): LogEventType[] {
  return LOG_EVENT_TYPE_IDS.filter((type) => types.includes(type));
}

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

export interface TypeMenuSection {
  heading: string;
  types: LogEventType[];
}

/** The menu's sections of the types on offer, in shared's order. */
export function typeMenu(offered: readonly LogEventType[]): TypeMenuSection[] {
  const sections: TypeMenuSection[] = [];
  for (const type of inCatalogueOrder(offered)) {
    const heading = TYPE_GROUP[type];
    const section = sections.find((candidate) => candidate.heading === heading);
    if (section) section.types.push(type);
    else sections.push({ heading, types: [type] });
  }
  return sections;
}

export interface TypeShortcut {
  label: string;
  types: LogEventType[];
}

/**
 * Choices at the top of the menu, each a whole set of types. A type always has the same level, so
 * "warnings and errors" is just the types that are warnings or errors. Everything is no filter.
 */
export function typeShortcuts(offered: readonly LogEventType[]): TypeShortcut[] {
  const of = (keep: (type: LogEventType) => boolean) => inCatalogueOrder(offered).filter(keep);
  return [
    { label: 'Everything', types: [] },
    { label: 'Changes to the data', types: of((type) => DATA_CHANGE_EVENT_TYPES.includes(type)) },
    { label: 'Warnings and errors', types: of((type) => LOG_EVENT_TYPES[type].level !== 'info') },
    { label: 'Errors only', types: of((type) => LOG_EVENT_TYPES[type].level === 'error') },
  ];
}

/** Both lists are in the catalogue's order, so comparing them in order is enough. */
export function sameTypes(a: readonly LogEventType[], b: readonly LogEventType[]): boolean {
  return a.length === b.length && a.every((type, i) => type === b[i]);
}

/** The menu button's summary of the choice, after "Show": "everything", "errors only", "3 types of event"… */
export function describeFilter(types: LogEventType[], offered: readonly LogEventType[] = LOG_EVENT_TYPE_IDS): string {
  const shortcut = typeShortcuts(offered).find((candidate) => sameTypes(candidate.types, types));
  if (shortcut) return midSentence(shortcut.label);
  if (types.length === 1) return midSentence(LOG_EVENT_TYPES[types[0]!].label);
  return `${types.length} types of event`;
}

/** A label as it reads after "Show": "Errors only" → "errors only", but "AI requests paused" stays. */
function midSentence(label: string): string {
  const firstWord = label.split(' ')[0]!;
  return firstWord === firstWord.toUpperCase() ? label : label.charAt(0).toLowerCase() + label.slice(1);
}
