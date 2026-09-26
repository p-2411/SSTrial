import { describe, expect, it } from 'vitest';
import { canTransition, UPLOAD_TRANSITIONS, type UploadTransition } from '../src/lifecycle.ts';
import { UPLOAD_STATUSES, type UploadStatus } from '../src/uploads.ts';

const transitions = Object.keys(UPLOAD_TRANSITIONS) as UploadTransition[];
/** The transitions that take an upload in `status` to a different status. */
const leaving = (status: UploadStatus) =>
  transitions.filter((transition) => canTransition(transition, status) && UPLOAD_TRANSITIONS[transition].to !== status);

describe('upload lifecycle', () => {
  it('lets an upload still being uploaded only be confirmed or discarded', () => {
    expect(leaving('uploading')).toEqual(['confirm', 'discard']);
  });

  it('only leaves a finished upload when someone runs it again or deletes it', () => {
    expect(leaving('completed')).toEqual(['rerun', 'delete']);
    expect(leaving('failed')).toEqual(['rerun', 'delete']);
  });

  it('can reach every status an upload is ever in, after it is created', () => {
    const reached = new Set(transitions.map((transition) => UPLOAD_TRANSITIONS[transition].to));
    expect(UPLOAD_STATUSES.filter((status) => status !== 'uploading' && !reached.has(status))).toEqual([]);
  });

  it.each(['review', 'revert', 'submit'] as const)('lets people %s only completed uploads, which stay completed', (transition) => {
    expect(UPLOAD_STATUSES.filter((status) => canTransition(transition, status))).toEqual(['completed']);
    expect(UPLOAD_TRANSITIONS[transition].to).toBe('completed');
  });

  it('lets a worker take over an attempt that is still processing (after a crash)', () => {
    expect(canTransition('claim', 'processing')).toBe(true);
    expect(canTransition('complete', 'queued')).toBe(false);
  });
});

describe('deleting an upload', () => {
  it('works from any status the list shows, and removes the row', () => {
    expect(UPLOAD_STATUSES.filter((status) => canTransition('delete', status))).toEqual(['queued', 'processing', 'completed', 'failed']);
    expect(UPLOAD_TRANSITIONS.delete.to).toBeNull();
  });
});
