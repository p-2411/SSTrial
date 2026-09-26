import { describe, expect, it } from 'vitest';
import type { LogEvent, LogEventType } from '@label-extractor/shared';
import { withRevertPoints } from '../../src/uploads/history.ts';
import type { UploadVersion } from '../../src/uploads/store.ts';

let nextId = 1;
const event = (type: LogEventType, versionId?: string): LogEvent => ({
  id: String(nextId++),
  occurredAt: new Date().toISOString(),
  source: 'api',
  level: 'info',
  type,
  uploadId: 'u1',
  message: type,
  data: versionId ? { versionId } : {},
});
const version = (id: string, source: UploadVersion['source'] = 'review'): UploadVersion => ({ id, source, createdAt: new Date() });
const revertPoints = (events: LogEvent[], versions: UploadVersion[]) =>
  withRevertPoints(events, versions).map((entry) => [entry.type, entry.revertTo]);

describe('withRevertPoints', () => {
  it('offers each change the data went through, except the one it is in now', () => {
    expect(
      revertPoints(
        [event('upload.created'), event('extraction.completed', '1'), event('upload.edited', '2'), event('upload.edited', '3')],
        [version('1', 'extraction'), version('2'), version('3')],
      ),
    ).toEqual([
      ['upload.created', null],
      ['extraction.completed', '1'],
      ['upload.edited', '2'],
      ['upload.edited', null], // where the data is now
    ]);
  });

  it("gives an upload read before versions existed its saved reading, at its last reading", () => {
    // Read, re-run and read again, then edited, all before versions: only the last reading was saved.
    expect(
      revertPoints(
        [event('extraction.completed'), event('upload.retry_requested'), event('extraction.completed'), event('upload.edited')],
        [version('7', 'extraction')],
      ),
    ).toEqual([
      ['extraction.completed', null],
      ['upload.retry_requested', null],
      ['extraction.completed', '7'],
      ['upload.edited', null], // not saved, so it can't be gone back to (but it can be left)
    ]);
  });

  it('offers nothing when the only saved state is the current one', () => {
    expect(revertPoints([event('extraction.completed')], [version('7', 'extraction')])).toEqual([['extraction.completed', null]]);
  });

  it("offers nothing for a version that's gone", () => {
    expect(revertPoints([event('extraction.completed', '1'), event('upload.edited', '2')], [version('2')])).toEqual([
      ['extraction.completed', null],
      ['upload.edited', null],
    ]);
  });
});
