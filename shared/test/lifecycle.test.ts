import { describe, expect, it } from 'vitest';
import { canTransition, UPLOAD_TRANSITIONS, type UploadTransition } from '../src/lifecycle.ts';
import { UPLOAD_STATUSES, type UploadStatus } from '../src/uploads.ts';

const transitions = Object.keys(UPLOAD_TRANSITIONS) as UploadTransition[];
const leaving = (status: UploadStatus) => transitions.filter((transition) => canTransition(transition, status));

describe('upload lifecycle', () => {
  it('lets an upload still being uploaded only be confirmed or discarded', () => {
    expect(leaving('uploading')).toEqual(['confirm', 'discard']);
  });

  it('only leaves a finished upload when someone runs it again', () => {
    expect(leaving('completed')).toEqual(['rerun']);
    expect(leaving('failed')).toEqual(['rerun']);
  });

  it('can reach every status an upload is ever in, after it is created', () => {
    const reached = new Set(transitions.map((transition) => UPLOAD_TRANSITIONS[transition].to));
    expect(UPLOAD_STATUSES.filter((status) => status !== 'uploading' && !reached.has(status))).toEqual([]);
  });

  it('lets a worker take over an attempt that is still processing (after a crash)', () => {
    expect(canTransition('claim', 'processing')).toBe(true);
    expect(canTransition('complete', 'queued')).toBe(false);
  });
});
