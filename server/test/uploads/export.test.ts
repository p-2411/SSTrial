import { describe, expect, it } from 'vitest';
import { csvCell, formatIngredient, toCsv, toJson } from '../../src/uploads/export.ts';
import type { UploadRecord } from '../../src/uploads/store.ts';
import { SAMPLE_EXTRACTION } from '../fakes.ts';

function record(overrides: Partial<UploadRecord> = {}): UploadRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fileName: 'granola-label.png',
    mimeType: 'image/png',
    sizeBytes: 1000,
    storagePath: 'x.png',
    contentSha256: null,
    claimToken: null,
    resultUnreadable: false,
    status: 'completed',
    attempts: 1,
    error: null,
    result: SAMPLE_EXTRACTION,
    createdAt: new Date('2026-09-25T01:00:00Z'),
    updatedAt: new Date('2026-09-25T01:00:05Z'),
    completedAt: new Date('2026-09-25T01:00:05Z'),
    ...overrides,
  };
}

async function* stream(...records: UploadRecord[]) {
  yield* records;
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) text += chunk;
  return text;
}

describe('csvCell', () => {
  it.each([
    ['plain text', 'Maple Pecan Crunch', 'Maple Pecan Crunch'],
    ['a comma', 'Nuts, seeds', '"Nuts, seeds"'],
    ['quotes', 'The "best" oats', '"The ""best"" oats"'],
    ['a line break', 'Line one\nline two', '"Line one\nline two"'],
    ['a number', 500, '500'],
    ['a missing value', null, ''],
  ])('writes %s correctly', (_label, value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it.each(['=HYPERLINK("http://evil")', '+1+1', '-2+3', '@SUM(A1)'])(
    'neutralises text a spreadsheet would run as a formula: %s',
    (value) => {
      expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
    },
  );
});

describe('formatIngredient', () => {
  it('puts the percentage in round brackets and sub-ingredients in square brackets', () => {
    expect(formatIngredient({ name: 'Rolled oats', percent: 48, subIngredients: [], allergens: [] })).toBe('Rolled oats (48%)');
    expect(formatIngredient({ name: 'Puffed rice', percent: null, subIngredients: ['rice', 'salt'], allergens: [] })).toBe(
      'Puffed rice [rice, salt]',
    );
    expect(formatIngredient({ name: 'Chocolate', percent: 20, subIngredients: ['sugar'], allergens: [] })).toBe(
      'Chocolate (20%) [sugar]',
    );
  });
});

describe('toCsv', () => {
  it('writes a BOM, a header and one row per completed upload', async () => {
    const csv = await collect(toCsv(stream(record(), record({ id: 'no-result', status: 'failed', result: null }))));
    const [header, row, trailing] = csv.split('\r\n');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(header).toBe(
      '﻿Upload ID,File name,Uploaded at,Product name,Brand,Net quantity,Unit,Net quantity as printed,Allergens,Ingredients',
    );
    expect(row).toBe(
      '11111111-1111-4111-8111-111111111111,granola-label.png,2026-09-25T01:00:00.000Z,Maple Pecan Crunch,Harvest & Hearth,' +
        '500,g,Net Wt 500 g,oats; pecans,"Rolled oats (48%); Pecans (10%); Puffed rice [rice, salt]"',
    );
    expect(trailing).toBe('');
  });

  it('leaves missing values empty', async () => {
    const csv = await collect(
      toCsv(stream(record({ result: { ...SAMPLE_EXTRACTION, brand: null, netWeight: null, allergens: [], ingredients: [] } }))),
    );
    expect(csv.split('\r\n')[1]).toBe(
      '11111111-1111-4111-8111-111111111111,granola-label.png,2026-09-25T01:00:00.000Z,Maple Pecan Crunch,,,,,,',
    );
  });
});

describe('toJson', () => {
  it('writes valid JSON with the full structured data of each completed upload', async () => {
    const json = JSON.parse(
      await collect(toJson(stream(record(), record({ status: 'failed', result: null })), new Date('2026-09-25T02:00:00Z'))),
    );

    expect(json).toEqual({
      exportedAt: '2026-09-25T02:00:00.000Z',
      uploads: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          fileName: 'granola-label.png',
          uploadedAt: '2026-09-25T01:00:00.000Z',
          completedAt: '2026-09-25T01:00:05.000Z',
          ...SAMPLE_EXTRACTION,
        },
      ],
    });
  });

  it('writes an empty list when nothing is completed', async () => {
    expect(JSON.parse(await collect(toJson(stream(), new Date())))).toMatchObject({ uploads: [] });
  });
});
