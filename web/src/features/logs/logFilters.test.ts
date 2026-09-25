import { describe, expect, it } from 'vitest';
import { readLogFilters } from './logFilters.ts';

const UPLOAD = '9e1b7c2a-0000-4000-8000-000000000001';

describe('readLogFilters', () => {
  it('reads the types and the upload from the URL, in the catalogue order', () => {
    expect(readLogFilters(new URLSearchParams(`type=extraction.failed&type=upload.rejected&upload=${UPLOAD}`))).toEqual({
      types: ['upload.rejected', 'extraction.failed'],
      upload: UPLOAD,
    });
  });

  it('drops values the server would refuse, and repeats, rather than failing the whole page', () => {
    expect(readLogFilters(new URLSearchParams('type=upload.exploded&type=extraction.failed&type=extraction.failed&upload=not-an-id'))).toEqual({
      types: ['extraction.failed'],
      upload: null,
    });
  });
});
