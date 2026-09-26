import { DATA_CHANGE_EVENT_TYPES, type UploadHistoryEntry } from '@label-extractor/shared';
import { toLogEvent } from '../logs/presenter.ts';
import type { LogEventSummary } from '../logs/store.ts';

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
