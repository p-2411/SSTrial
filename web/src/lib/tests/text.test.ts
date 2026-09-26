import { describe, expect, it } from 'vitest';
import { capitalise, midSentence } from '../text';

describe('midSentence', () => {
  it('lower-cases a label to follow another word', () => {
    expect(midSentence('Errors only')).toBe('errors only');
    expect(midSentence('Last 7 days')).toBe('last 7 days');
    expect(midSentence('Since Sep 3')).toBe('since Sep 3');
  });

  it('keeps the capital of an abbreviation or a month', () => {
    expect(midSentence('AI requests paused')).toBe('AI requests paused');
    expect(midSentence('Sep 3 – Sep 26')).toBe('Sep 3 – Sep 26');
  });
});

describe('capitalise', () => {
  it('capitalises the first letter only', () => {
    expect(capitalise('database and queue')).toBe('Database and queue');
  });
});
