import { DATA_CHANGE_EVENT_TYPES, type EventDetails, type UploadHistoryEntry } from '@label-extractor/shared';
import { eventDetails } from '../logs/details.ts';
import { recordHasDetails, toLogEvent } from '../logs/presenter.ts';
import type { EventFilters, EventQueries, LogEventSummary } from '../logs/store.ts';
import { findVisible, type Person } from './access.ts';
import type { UploadQueries } from './store.ts';

/**
 * One upload's history, for anyone who can see the upload (see uploads/access.ts), unlike the whole
 * activity log: what happened to it, newest first, searched and filtered like the log.
 */

export interface HistoryDeps {
  uploads: Pick<UploadQueries, 'findById' | 'latestVersionId' | 'readVersion'>;
  events: Pick<EventQueries, 'list' | 'find'>;
}

/**
 * Up to `limit` of the upload's events, newest first, from after the event `after`; null if there's
 * no such upload that this person can see.
 */
export async function loadUploadHistory(
  deps: HistoryDeps,
  id: string,
  query: EventFilters & { limit: number; after?: string },
  person: Person,
): Promise<UploadHistoryEntry[] | null> {
  if (!(await findVisible(deps.uploads, id, person))) return null;
  const [events, currentVersionId] = await Promise.all([deps.events.list({ ...query, uploadId: id }), deps.uploads.latestVersionId(id)]);
  return toHistoryEntries(events, currentVersionId);
}

export type HistoryDetailsOutcome =
  | { outcome: 'found'; details: EventDetails }
  /** No such upload that this person can see. */
  | { outcome: 'no-upload' }
  /** No such event in its history, or none with details to open there. */
  | { outcome: 'no-event' };

/** One history entry's details (what was read, or what changed), read only when someone opens it. */
export async function loadHistoryDetails(deps: HistoryDeps, id: string, eventId: string, person: Person): Promise<HistoryDetailsOutcome> {
  if (!(await findVisible(deps.uploads, id, person))) return { outcome: 'no-upload' };
  const event = await deps.events.find(eventId);
  // Only what the history offers to open: other events' facts are for the activity log, admins only.
  if (!event || event.uploadId !== id || !recordHasDetails(event, 'history')) return { outcome: 'no-event' };
  return { outcome: 'found', details: await eventDetails(event, deps.uploads) };
}

/**
 * A page of an upload's history, each entry with the version "Revert" would put the data back to:
 * the one its change saved (`versionId`), unless that's the state the data is in now
 * (`currentVersionId`), where there's nothing to go back to.
 */
export function toHistoryEntries(events: LogEventSummary[], currentVersionId: string | null): UploadHistoryEntry[] {
  return events.map((event) => {
    const version = DATA_CHANGE_EVENT_TYPES.includes(event.type) ? event.versionId : null;
    return { ...toLogEvent(event, 'history'), revertTo: version !== currentVersionId ? version : null };
  });
}
