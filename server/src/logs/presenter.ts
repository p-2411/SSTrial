import type { LogEvent } from '@label-extractor/shared';
import type { LogEventSummary } from './store.ts';

/**
 * Where an event is listed: the Logs page, for admins, or a product's history, for anyone who can
 * see the product. Changes to its data have details in both (what was read, or what changed); other
 * events' facts, the codes and numbers their message leaves out, are only for the Logs page.
 */
export type EventListing = 'log' | 'history';

/** An event as the lists return it: dates as ISO strings, and whether it has details to open. */
export function toLogEvent(event: LogEventSummary, listing: EventListing): LogEvent {
  const { versionId, hasFacts, ...shown } = event;
  return { ...shown, occurredAt: event.occurredAt.toISOString(), hasDetails: hasDetails(event, listing) };
}

function hasDetails(event: LogEventSummary, listing: EventListing): boolean {
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
