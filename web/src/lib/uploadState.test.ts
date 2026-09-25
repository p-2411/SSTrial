import { describe, expect, it } from 'vitest';
import { summary } from '@/test/fixtures';
import { uploadState } from './uploadState';

const rateLimited = { code: 'LLM_RATE_LIMITED', message: 'The AI service is rate-limiting requests.' } as const;

describe('uploadState', () => {
  it('tells a first wait apart from a retry after a failed attempt', () => {
    expect(uploadState(summary({ status: 'queued', error: null }))).toEqual({ kind: 'waiting' });
    expect(uploadState(summary({ status: 'queued', error: rateLimited }))).toEqual({ kind: 'retrying', error: rateLimited });
  });

  it('tells a readable result apart from one saved in a shape this version cannot read', () => {
    expect(uploadState(summary({ status: 'completed' }))).toEqual({ kind: 'completed' });
    expect(uploadState(summary({ status: 'completed', resultUnreadable: true }))).toEqual({ kind: 'unreadable' });
  });

  it('keeps the reason a failed upload failed', () => {
    expect(uploadState(summary({ status: 'failed', error: rateLimited }))).toEqual({ kind: 'failed', error: rateLimited });
    expect(uploadState(summary({ status: 'failed', error: null }))).toEqual({ kind: 'failed', error: null });
  });

  it('passes the in-flight statuses through', () => {
    expect(uploadState(summary({ status: 'uploading' }))).toEqual({ kind: 'uploading' });
    expect(uploadState(summary({ status: 'processing' }))).toEqual({ kind: 'processing' });
  });
});
