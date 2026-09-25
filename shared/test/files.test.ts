import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES, formatBytes, validateFileMetadata } from '../src/files.ts';

describe('validateFileMetadata', () => {
  it.each([
    ['label.jpg', 'image/jpeg'],
    ['label.JPEG', 'image/jpeg'],
    ['label.png', 'image/png'],
    ['label.webp', 'image/webp'],
    ['label.pdf', 'application/pdf'],
  ])('accepts %s (%s)', (name, type) => {
    expect(validateFileMetadata({ name, type, size: 1000 })).toEqual({ ok: true, mimeType: type });
  });

  it('normalises the legacy image/jpg type and MIME parameters', () => {
    expect(validateFileMetadata({ name: 'a.jpg', type: 'image/jpg', size: 1 })).toMatchObject({ mimeType: 'image/jpeg' });
    expect(validateFileMetadata({ name: 'a.pdf', type: 'application/pdf; charset=binary', size: 1 })).toMatchObject({
      mimeType: 'application/pdf',
    });
  });

  it('falls back to the extension when the browser reports no type', () => {
    expect(validateFileMetadata({ name: 'scan.pdf', type: '', size: 1 })).toEqual({ ok: true, mimeType: 'application/pdf' });
  });

  it.each([
    ['notes.txt', 'text/plain'],
    ['archive.zip', 'application/zip'],
    ['animation.gif', 'image/gif'],
    ['no-extension', ''],
  ])('rejects unsupported file %s', (name, type) => {
    const result = validateFileMetadata({ name, type, size: 1000 });
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_FILE_TYPE' });
    if (!result.ok) expect(result.message).toContain('JPEG, PNG, WebP or PDF');
  });

  it('gives an actionable message for iPhone HEIC photos', () => {
    const result = validateFileMetadata({ name: 'IMG_0042.HEIC', type: 'image/heic', size: 1000 });
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_FILE_TYPE' });
    if (!result.ok) expect(result.message).toMatch(/export the photo as JPEG/i);
  });

  it('rejects empty files', () => {
    expect(validateFileMetadata({ name: 'a.png', type: 'image/png', size: 0 })).toMatchObject({ ok: false, code: 'EMPTY_FILE' });
  });

  it('rejects files over the size limit, and accepts one exactly at it', () => {
    expect(validateFileMetadata({ name: 'a.png', type: 'image/png', size: MAX_FILE_SIZE_BYTES })).toMatchObject({ ok: true });
    const result = validateFileMetadata({ name: 'a.png', type: 'image/png', size: MAX_FILE_SIZE_BYTES + 1 });
    expect(result).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
    if (!result.ok) expect(result.message).toContain('10 MB');
  });

  it('rejects blank and over-long file names', () => {
    expect(validateFileMetadata({ name: '   ', type: 'image/png', size: 1 })).toMatchObject({ code: 'INVALID_FILE_NAME' });
    expect(validateFileMetadata({ name: `${'a'.repeat(300)}.png`, type: 'image/png', size: 1 })).toMatchObject({
      code: 'INVALID_FILE_NAME',
    });
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [1536, '1.5 KB'],
    [10 * 1024 * 1024, '10 MB'],
  ])('formats %d as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
