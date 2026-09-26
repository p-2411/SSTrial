import { LABEL_FIELDS, type EventDetails, type FieldChange, type LabelExtraction, type LabelField } from '@label-extractor/shared';
import type { UploadQueries } from '../uploads/store.ts';
import type { LogEventRecord } from './store.ts';

/**
 * What opening an event shows, read only then: lists leave details out, and most are never opened.
 *
 *   - An extraction completing: the data as the AI read it, from the version it saved.
 *   - An edit or check: what it changed, from its own record (only what the person changed, not
 *     what followed from it).
 *   - A revert: what it changed, comparing the version it saved with the one before.
 *   - Anything else: its facts, the codes and numbers its message leaves out.
 */
export async function eventDetails(event: LogEventRecord, uploads: Pick<UploadQueries, 'readVersion'>): Promise<EventDetails> {
  const { data } = event;
  switch (event.type) {
    case 'upload.edited':
      return { kind: 'changes', changes: recordedChanges(data.changes), checked: knownFields(data.checked), unchecked: [] };
    case 'extraction.completed':
    case 'upload.reverted': {
      const versionId = typeof data.versionId === 'string' ? data.versionId : null;
      if (versionId === null || event.uploadId === null) return { kind: 'facts', facts: data };
      // Versions go with their upload, so none means it was deleted.
      const saved = await uploads.readVersion(event.uploadId, versionId);
      if (!saved) return { kind: 'gone' };
      const { version, previous } = saved;
      if (event.type === 'extraction.completed') return { kind: 'reading', result: version.result as LabelExtraction };
      return {
        kind: 'changes',
        changes: changesBetween(previous?.result, version.result),
        checked: [],
        // A revert can undo checks without changing a value.
        unchecked: knownFields((previous?.reviewed ?? []).filter((field) => !version.reviewed.includes(field))),
      };
    }
    default:
      return { kind: 'facts', facts: data };
  }
}

/** An edit's record of its changes (`{ brand: { from, to } }`), in the order the fields are shown. */
function recordedChanges(recorded: unknown): FieldChange[] {
  if (!isObject(recorded)) return [];
  return LABEL_FIELDS.flatMap((field) => {
    const change = recorded[field];
    return isObject(change) ? [{ field, from: change.from ?? null, to: change.to ?? null }] : [];
  });
}

/** The fields whose values differ between two saved results. */
export function changesBetween(before: unknown, after: unknown): FieldChange[] {
  const from = isObject(before) ? before : {};
  const to = isObject(after) ? after : {};
  return LABEL_FIELDS.filter((field) => JSON.stringify(from[field] ?? null) !== JSON.stringify(to[field] ?? null)).map(
    (field) => ({ field, from: from[field] ?? null, to: to[field] ?? null }),
  );
}

function knownFields(fields: unknown): LabelField[] {
  return Array.isArray(fields) ? LABEL_FIELDS.filter((field) => fields.includes(field)) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
