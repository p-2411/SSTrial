import { describe, expect, it } from 'vitest';
import type { LogEventType } from '@label-extractor/shared';
import type { LogEventSummary } from '../../src/logs/store.ts';
import { toHistoryEntries } from '../../src/uploads/history.ts';

let nextId = 1;
const event = (type: LogEventType, versionId: string | null = null): LogEventSummary => ({
  id: String(nextId++),
  occurredAt: new Date(),
  source: 'api',
  level: 'info',
  type,
  uploadId: 'u1',
  message: type,
  fileName: 'oats.png',
  versionId,
  hasFacts: true,
});
const revertPoints = (events: LogEventSummary[], current: string | null) =>
  toHistoryEntries(events, current).map((entry) => [entry.type, entry.revertTo]);

describe('toHistoryEntries', () => {
  it('offers each change the data went through, except the one it is in now', () => {
    expect(
      revertPoints(
        [event('upload.edited', '3'), event('upload.edited', '2'), event('extraction.completed', '1'), event('upload.created')],
        '3',
      ),
    ).toEqual([
      ['upload.edited', null], // where the data is now
      ['upload.edited', '2'],
      ['extraction.completed', '1'],
      ['upload.created', null],
    ]);
  });

  it('offers nothing for a change that saved no version (an edit from before versions existed)', () => {
    expect(revertPoints([event('upload.edited'), event('extraction.completed', '7')], '7')).toEqual([
      ['upload.edited', null],
      ['extraction.completed', null],
    ]);
  });

  it('only offers changes to the data, whatever else names a version', () => {
    expect(revertPoints([event('upload.retry_requested', '5')], '9')).toEqual([['upload.retry_requested', null]]);
  });

  it('says which entries have details: changes to the data, not the rest', () => {
    const details = toHistoryEntries(
      [event('upload.edited'), event('upload.reverted', '4'), event('extraction.completed'), event('extraction.failed')],
      null,
    ).map((entry) => [entry.type, entry.hasDetails]);
    expect(details).toEqual([
      ['upload.edited', true], // its own record of what changed
      ['upload.reverted', true],
      ['extraction.completed', false], // no saved reading to show
      ['extraction.failed', false], // its facts are for the Logs page
    ]);
  });
});
