import type { LogEvent } from '@label-extractor/shared';
import type { LogEventRecord, LogEventSummary } from './store.ts';

/**
 * Where an event is listed: the activity log (on the System page), for admins, or a product's
 * history, for anyone who can see the product. Changes to its data have details in both (what was
 * read, or what changed); other events' facts, the codes and numbers their message leaves out, are
 * only for the activity log.
 */
export type EventListing = 'log' | 'history';

/** An event as the lists return it: dates as ISO strings, and whether it has details to open. */
export function toLogEvent(event: LogEventSummary, listing: EventListing): LogEvent {
  const { versionId, hasFacts, ...shown } = event;
  return { ...shown, occurredAt: event.occurredAt.toISOString(), hasDetails: hasDetails(event, listing) };
}

/** The same, for an event read with its data (see EventQueries.find): what its details are fetched from. */
export function recordHasDetails(event: LogEventRecord, listing: EventListing): boolean {
  const versionId = typeof event.data.versionId === 'string' ? event.data.versionId : null;
  const hasFacts = Object.keys(event.data).some((key) => key !== 'fileName');
  return hasDetails({ type: event.type, versionId, hasFacts }, listing);
}

function hasDetails(event: Pick<LogEventSummary, 'type' | 'versionId' | 'hasFacts'>, listing: EventListing): boolean {
  switch (event.type) {
    // An edit's details are its own record of what changed; a reading or revert needs its version.
    case 'upload.edited':
      return true;
    case 'extraction.completed':
    case 'upload.reverted':
      return event.versionId !== null;
    default:
      return listing === 'log' && event.hasFacts;
  }
}
