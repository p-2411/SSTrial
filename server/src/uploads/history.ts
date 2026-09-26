import type { LogEvent, LogEventType, UploadHistoryEntry } from '@label-extractor/shared';
import type { UploadVersion } from './store.ts';

/** The events that change an upload's data, each saving the new state as a version. */
const DATA_CHANGES: readonly LogEventType[] = ['extraction.completed', 'upload.edited', 'upload.reverted'];

/**
 * An upload's history (its events, oldest first) with, for each entry that changed the data, the
 * version "Revert to here" would put it back to. The state the data is in now is left out: there's
 * nothing to revert to there.
 *
 * Entries name their version in `data.versionId`. Uploads read before versions existed have one
 * saved reading without an entry naming it (see the upload_versions migration); it belongs to
 * their last "Extraction completed".
 */
export function withRevertPoints(events: LogEvent[], versions: UploadVersion[]): UploadHistoryEntry[] {
  const saved = new Set(versions.map((version) => version.id));
  const named = new Set(events.map(versionNamedBy).filter((id) => id !== null));
  const unnamedReading = versions.findLast((version) => version.source === 'extraction' && !named.has(version.id))?.id ?? null;
  const lastUnnamedReading = events.findLast((event) => event.type === 'extraction.completed' && versionNamedBy(event) === null);

  const versionOf = (event: LogEvent): string | null => {
    if (!DATA_CHANGES.includes(event.type)) return null;
    const id = versionNamedBy(event) ?? (event === lastUnnamedReading ? unnamedReading : null);
    return id !== null && saved.has(id) ? id : null;
  };
  const latestChange = events.findLast((event) => DATA_CHANGES.includes(event.type));
  const current = latestChange ? versionOf(latestChange) : null;

  return events.map((event) => {
    const version = versionOf(event);
    return { ...event, revertTo: version !== current ? version : null };
  });
}

function versionNamedBy(event: LogEvent): string | null {
  return typeof event.data.versionId === 'string' ? event.data.versionId : null;
}
