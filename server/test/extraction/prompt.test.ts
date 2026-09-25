import { describe, expect, it } from 'vitest';
import { CONFIDENT_SCORE, DOUBTFUL_SCORE } from '@label-extractor/shared';
import { EXTRACTION_INSTRUCTIONS } from '../../src/extraction/prompt.ts';

describe('extraction instructions', () => {
  it("describe the same confidence bands the app uses, so the model's doubt is where the UI looks", () => {
    expect(EXTRACTION_INSTRUCTIONS).toContain(`${CONFIDENT_SCORE}–100: clearly printed and clearly read`);
    expect(EXTRACTION_INSTRUCTIONS).toContain(`${DOUBTFUL_SCORE}–${CONFIDENT_SCORE - 1}: partly obscured`);
    expect(EXTRACTION_INSTRUCTIONS).toContain(`Below ${DOUBTFUL_SCORE}: hard to read`);
    expect(EXTRACTION_INSTRUCTIONS).toContain(`reason for any score below ${CONFIDENT_SCORE}`);
  });
});
