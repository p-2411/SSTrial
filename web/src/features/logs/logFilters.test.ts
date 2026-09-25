import { describe, expect, it } from 'vitest';
import { readLogFilters } from './logFilters.ts';

const UPLOAD = '9e1b7c2a-0000-4000-8000-000000000001';

describe('readLogFilters', () => {
  it('reads the level, type and upload from the URL', () => {
    expect(readLogFilters(new URLSearchParams(`level=error&type=extraction.failed&upload=${UPLOAD}`))).toEqual({
      level: 'error',
      type: 'extraction.failed',
      upload: UPLOAD,
    });
  });

  it('drops values the server would refuse, rather than failing the whole page', () => {
    expect(readLogFilters(new URLSearchParams('level=debug&type=upload.exploded&upload=not-an-id'))).toEqual({
      level: 'all',
      type: null,
      upload: null,
    });
  });
});
