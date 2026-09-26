import { describe, expect, it } from 'vitest';
import { LOG_EVENT_TYPE_IDS, UPLOAD_EVENT_TYPE_IDS } from '@label-extractor/shared';
import { describeFilter, typeMenu, typeShortcuts } from './eventTypes.ts';

describe('the type menu', () => {
  it('offers every type once, under a heading', () => {
    const menu = typeMenu(LOG_EVENT_TYPE_IDS);
    expect(menu.map((section) => section.heading)).toEqual(['Uploads', 'Extraction', 'System']);
    expect(menu.flatMap((section) => section.types).sort()).toEqual([...LOG_EVENT_TYPE_IDS].sort());
  });

  it("offers a product's history only the types an upload can have", () => {
    expect(typeMenu(UPLOAD_EVENT_TYPE_IDS).map((section) => section.heading)).toEqual(['Uploads', 'Extraction']);
  });

  it('has shortcuts for whole sets: everything, changes to the data, warnings and errors, errors', () => {
    expect(typeShortcuts(LOG_EVENT_TYPE_IDS)).toEqual([
      { label: 'Everything', types: [] },
      { label: 'Changes to the data', types: ['upload.edited', 'upload.reverted', 'extraction.completed'] },
      { label: 'Warnings and errors', types: ['upload.rejected', 'extraction.retry_scheduled', 'extraction.failed', 'extraction.abandoned', 'ratelimit.paused'] },
      { label: 'Errors only', types: ['extraction.failed', 'extraction.abandoned'] },
    ]);
  });

  it('sums up the choice as it reads after "Show"', () => {
    expect(describeFilter([])).toBe('everything');
    expect(describeFilter(['extraction.failed', 'extraction.abandoned'])).toBe('errors only');
    expect(describeFilter(['upload.edited', 'upload.reverted', 'extraction.completed'])).toBe('changes to the data');
    expect(describeFilter(['extraction.failed'])).toBe('extraction failed');
    expect(describeFilter(['ratelimit.paused'])).toBe('label reading paused');
    expect(describeFilter(['upload.created', 'upload.queued'])).toBe('2 types of event');
  });
});
