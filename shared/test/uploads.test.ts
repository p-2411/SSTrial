import { describe, expect, it } from 'vitest';
import { applyConfidenceChecks, DOUBTFUL_SCORE } from '../src/confidence.ts';
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

describe('applyConfidenceChecks', () => {
  const sure = { score: 95, reasons: [] };
  const confidence = { productName: sure, brand: sure, netWeight: sure, allergens: sure, ingredients: sure };
  const result = {
    productName: 'Oat bar',
    brand: null,
    netWeight: { value: 500, unit: 'g' as const, text: 'Net Wt 250 g' },
    allergens: ['oats'],
    ingredients: [{ name: 'Oats', percent: 60, subIngredients: [], allergens: ['oats'] }],
  };

  it('caps a field the data contradicts, and says why', () => {
    const checked = applyConfidenceChecks(result, confidence);
    expect(checked.netWeight).toEqual({ score: DOUBTFUL_SCORE, reasons: ["The amount isn't in the printed net quantity."] });
    expect(checked.productName).toEqual(sure);
  });

  it('gives the same answer when applied again (it runs on every read)', () => {
    const once = applyConfidenceChecks(result, confidence);
    expect(applyConfidenceChecks(result, once)).toEqual(once);
  });

  it('leaves the stored scores untouched', () => {
    applyConfidenceChecks(result, confidence);
    expect(confidence.netWeight).toEqual(sure);
  });
});
