import { describe, expect, it } from 'vitest';
import { readActivityLogFilters } from './activityLogFilters.ts';

const UPLOAD = '9e1b7c2a-0000-4000-8000-000000000001';

describe('readActivityLogFilters', () => {
  it('reads the search, the types, the days and the upload from the URL, the types in the catalogue order', () => {
    expect(
      readActivityLogFilters(
        new URLSearchParams(`q=+oat+milk+&type=extraction.failed&type=upload.rejected&from=2026-09-01&to=2026-09-26&upload=${UPLOAD}`),
      ),
    ).toEqual({
      search: 'oat milk',
      types: ['upload.rejected', 'extraction.failed'],
      from: '2026-09-01',
      to: '2026-09-26',
      upload: UPLOAD,
    });
  });

  it('drops values the server would refuse, and repeats, rather than failing the whole page', () => {
    expect(
      readActivityLogFilters(new URLSearchParams('type=upload.exploded&type=extraction.failed&type=extraction.failed&from=2026-02-30&to=soon&upload=not-an-id')),
    ).toEqual({
      search: '',
      types: ['extraction.failed'],
      from: null,
      to: null,
      upload: null,
    });
    expect(readActivityLogFilters(new URLSearchParams(`q=${'a'.repeat(201)}`)).search).toHaveLength(200);
  });

  it('reads days written the wrong way round as the days between them', () => {
    expect(readActivityLogFilters(new URLSearchParams('from=2026-09-26&to=2026-09-01'))).toMatchObject({ from: '2026-09-01', to: '2026-09-26' });
  });
});
