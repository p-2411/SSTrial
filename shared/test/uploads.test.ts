import { describe, expect, it } from 'vitest';
import { isVolumeUnit } from '../src/units.ts';
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
