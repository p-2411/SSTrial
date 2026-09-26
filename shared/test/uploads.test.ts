import { canDeleteUpload } from '../src/auth.ts';
import { describe, expect, it } from 'vitest';
import { isVolumeUnit, textShowsAmount } from '../src/units.ts';
import { isActiveStatus, isUploadStatus, storedErrorCode, uploadErrorMessage } from '../src/uploads.ts';

describe('storedErrorCode', () => {
  it('keeps a code the catalogue knows', () => {
    expect(storedErrorCode('LLM_TIMEOUT')).toBe('LLM_TIMEOUT');
  });

  it('reads a code this version no longer knows as a generic failure, which still has a message', () => {
    expect(storedErrorCode('FILE_CONTENT_MISMATCH')).toBe('INTERNAL_ERROR');
    expect(uploadErrorMessage(storedErrorCode('toString'))).toBe('Something went wrong while processing this file.');
  });
});

describe('statuses', () => {
  it('treats queued and processing uploads as active', () => {
    expect(['uploading', 'queued', 'processing', 'completed', 'failed'].filter((s) => isUploadStatus(s) && isActiveStatus(s))).toEqual([
      'queued',
      'processing',
    ]);
  });

  it('recognises only real statuses', () => {
    expect(isUploadStatus('completed')).toBe(true);
    expect(isUploadStatus('done')).toBe(false);
  });
});

describe('isVolumeUnit', () => {
  it('tells volume from mass', () => {
    expect(['ml', 'l', 'fl oz'].every((unit) => isVolumeUnit(unit as 'ml'))).toBe(true);
    expect(['g', 'kg', 'oz'].some((unit) => isVolumeUnit(unit as 'g'))).toBe(false);
  });
});

describe('textShowsAmount', () => {
  it.each([
    ['Net Wt 16 oz (454 g)', 454, true],
    ['Net Wt 2.2 lb (1,000 g)', 1000, true], // thousands separator
    ['1.000 kg', 1000, true], // European thousands separator
    ['1.000 kg', 1, true], // …or a decimal point: both readings count
    ['454,0 g', 454, true], // decimal comma
    ['375 g', 37.5, false],
    ['Net 500 ml', 50, false],
  ])('%s states %s: %s', (text, amount, expected) => {
    expect(textShowsAmount(text, amount)).toBe(expected);
  });
});

describe('canDeleteUpload', () => {
  const uploader = { id: 'user-1', role: 'member' as const };
  it.each([
    ['the uploader', 'user-1', uploader, true],
    ['another member', 'user-1', { id: 'user-2', role: 'member' as const }, false],
    ['an admin', 'user-1', { id: 'user-3', role: 'admin' as const }, true],
    ['a member, for an upload from before sign-in', null, uploader, false],
    ['an admin, for an upload from before sign-in', null, { id: 'user-3', role: 'admin' as const }, true],
  ])('%s: %s', (_label, uploaderId, person, expected) => {
    expect(canDeleteUpload(uploaderId, person)).toBe(expected);
  });
});
