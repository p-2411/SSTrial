import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@label-extractor/shared';
import { groupByDay } from '../groupByDay.ts';

const at = (occurredAt: Date, id: string): LogEvent => ({
  id,
  occurredAt: occurredAt.toISOString(),
  source: 'worker',
  level: 'info',
  type: 'extraction.started',
  uploadId: null,
  message: id,
  fileName: null,
  hasDetails: false,
});

// Local times, as the page shows them: the day boundary is the viewer's midnight.
const now = new Date(2026, 8, 25, 9, 30).getTime();

describe('groupByDay', () => {
  it('splits events into runs on the same day, keeping their order', () => {
    const days = groupByDay(
      [
        at(new Date(2026, 8, 25, 9, 0), 'a'),
        at(new Date(2026, 8, 25, 0, 5), 'b'),
        at(new Date(2026, 8, 24, 23, 55), 'c'),
        at(new Date(2026, 8, 22, 12, 0), 'd'),
      ],
      now,
    );

    expect(days.map((day) => [day.label, day.events.map((event) => event.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Tuesday, September 22', ['d']],
    ]);
  });

  it("adds the year to days from another year", () => {
    const [day] = groupByDay([at(new Date(2025, 11, 31, 12, 0), 'a')], now);
    expect(day!.label).toBe('Wednesday, December 31, 2025');
  });

  it('returns nothing for no events', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
