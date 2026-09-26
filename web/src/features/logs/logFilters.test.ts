import { describe, expect, it } from 'vitest';
import { LOG_EVENT_TYPE_IDS } from '@label-extractor/shared';
import { describeFilter, readLogFilters, TYPE_MENU } from './logFilters.ts';

describe('the type menu', () => {
  it('offers every type once, under a heading', () => {
    expect(TYPE_MENU.map((section) => section.heading)).toEqual(['Uploads', 'Extraction', 'System']);
    expect(TYPE_MENU.flatMap((section) => section.types).sort()).toEqual([...LOG_EVENT_TYPE_IDS].sort());
  });

  it('sums up the choice as it reads after "Show"', () => {
    expect(describeFilter([])).toBe('everything');
    expect(describeFilter(['extraction.failed', 'extraction.abandoned'])).toBe('errors only');
    expect(describeFilter(['extraction.failed'])).toBe('extraction failed');
    expect(describeFilter(['ratelimit.paused'])).toBe('AI requests paused'); // an acronym keeps its capitals
    expect(describeFilter(['upload.created', 'upload.queued'])).toBe('2 types of event');
  });
});

const UPLOAD = '9e1b7c2a-0000-4000-8000-000000000001';

describe('readLogFilters', () => {
  it('reads the search, the types and the upload from the URL, the types in the catalogue order', () => {
    expect(readLogFilters(new URLSearchParams(`q=+oat+milk+&type=extraction.failed&type=upload.rejected&upload=${UPLOAD}`))).toEqual({
      search: 'oat milk',
      types: ['upload.rejected', 'extraction.failed'],
      upload: UPLOAD,
    });
  });

  it('drops values the server would refuse, and repeats, rather than failing the whole page', () => {
    expect(readLogFilters(new URLSearchParams('type=upload.exploded&type=extraction.failed&type=extraction.failed&upload=not-an-id'))).toEqual({
      search: '',
      types: ['extraction.failed'],
      upload: null,
    });
    expect(readLogFilters(new URLSearchParams(`q=${'a'.repeat(201)}`)).search).toHaveLength(200);
  });
});
