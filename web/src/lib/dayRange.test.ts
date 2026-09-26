import { describe, expect, it } from 'vitest';
import { addDays, ANY_TIME, describeDayRange, isDay, toInstants } from './dayRange';

const TODAY = '2026-09-26';

describe('days', () => {
  it('knows a real day from a malformed or impossible one', () => {
    expect(isDay('2026-09-26')).toBe(true);
    expect(isDay('2024-02-29')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-9-26')).toBe(false);
    expect(isDay('yesterday')).toBe(false);
  });

  it('counts days across months and years', () => {
    expect(addDays('2026-09-26', -29)).toBe('2026-08-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('asks the server for the viewer’s own midnights: from the first day to the start of the day after the last', () => {
    const { from, to } = toInstants({ from: '2026-09-01', to: '2026-09-26' });
    expect(new Date(from!)).toEqual(new Date(2026, 8, 1));
    expect(new Date(to!)).toEqual(new Date(2026, 8, 27));
    expect(toInstants(ANY_TIME)).toEqual({});
  });
});

describe('describeDayRange', () => {
  it('names the common spans, counted back from today', () => {
    expect(describeDayRange(ANY_TIME, TODAY)).toBe('Any time');
    expect(describeDayRange({ from: TODAY, to: TODAY }, TODAY)).toBe('Today');
    expect(describeDayRange({ from: '2026-09-25', to: '2026-09-25' }, TODAY)).toBe('Yesterday');
    expect(describeDayRange({ from: '2026-09-20', to: TODAY }, TODAY)).toBe('Last 7 days');
    expect(describeDayRange({ from: '2026-08-28', to: TODAY }, TODAY)).toBe('Last 30 days');
  });

  it('writes out any other days, with the year only when it isn’t this one', () => {
    expect(describeDayRange({ from: '2026-09-03', to: '2026-09-03' }, TODAY)).toBe('Sep 3');
    expect(describeDayRange({ from: '2026-09-03', to: '2026-09-10' }, TODAY)).toBe('Sep 3 – Sep 10');
    expect(describeDayRange({ from: '2025-12-30', to: '2026-01-02' }, TODAY)).toBe('Dec 30, 2025 – Jan 2');
    expect(describeDayRange({ from: '2026-09-03', to: null }, TODAY)).toBe('Since Sep 3');
    expect(describeDayRange({ from: null, to: '2026-09-03' }, TODAY)).toBe('Until Sep 3');
  });
});
