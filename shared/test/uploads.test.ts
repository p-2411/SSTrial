import { canDeleteUpload, canRevertUpload, canViewUpload } from '../src/auth.ts';
import { describe, expect, it } from 'vitest';
import { isVolumeUnit, textShowsAmount } from '../src/units.ts';
import { isActiveStatus, isProduct, isUploadStatus, storedErrorCode, uploadErrorMessage } from '../src/uploads.ts';

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

describe('isProduct', () => {
  it('is a read upload its uploader has submitted, and nothing else', () => {
    expect(isProduct({ status: 'completed', submittedAt: '2026-09-26T10:00:00Z' })).toBe(true);
    expect(isProduct({ status: 'completed', submittedAt: null })).toBe(false); // still in Review
    expect(isProduct({ status: 'queued', submittedAt: null })).toBe(false);
  });
});

describe('who may do what with an upload', () => {
  const uploader = { id: 'user-1', role: 'member' as const };
  const member = { id: 'user-2', role: 'member' as const };
  const admin = { id: 'user-3', role: 'admin' as const };
  const product = (uploaderId: string | null) => ({ product: true, uploaderId });
  const unsubmitted = (uploaderId: string | null) => ({ product: false, uploaderId });

  it.each([
    ['the uploader sees their own', unsubmitted('user-1'), uploader, true],
    ['nobody else sees it, admins included', unsubmitted('user-1'), admin, false],
    ['everyone sees a product', product('user-1'), member, true],
    ['admins see one from before sign-in', unsubmitted(null), admin, true],
    ['members do not', unsubmitted(null), member, false],
  ])('seeing it: %s', (_label, upload, person, expected) => {
    expect(canViewUpload(upload, person)).toBe(expected);
  });

  it.each([
    ['the uploader', product('user-1'), uploader, true],
    ['another member', product('user-1'), member, false],
    ['an admin', product('user-1'), admin, true],
    ['an admin, for one they cannot see', unsubmitted('user-1'), admin, false],
    ['a member, for an upload from before sign-in', product(null), uploader, false],
    ['an admin, for an upload from before sign-in', product(null), admin, true],
  ])('deleting it: %s', (_label, upload, person, expected) => {
    expect(canDeleteUpload(upload, person)).toBe(expected);
  });

  it('lets admins revert only what they can see', () => {
    expect(canRevertUpload(product('user-1'), admin)).toBe(true);
    expect(canRevertUpload(unsubmitted('user-1'), admin)).toBe(false);
    expect(canRevertUpload(product('user-1'), uploader)).toBe(false);
  });
});
