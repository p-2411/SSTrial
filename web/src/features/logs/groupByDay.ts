import type { LogEvent } from '@label-extractor/shared';

export interface DayOfEvents {
  key: string;
  /** "Today", "Yesterday", "Tuesday, September 23", or with the year when it isn't this year's. */
  label: string;
  events: LogEvent[];
}

const thisYearsDate = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' });
const otherYearsDate = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Splits events (in the order given) into runs on the same local calendar day, each with its label. */
export function groupByDay(events: LogEvent[], now: number): DayOfEvents[] {
  const days: DayOfEvents[] = [];
  for (const event of events) {
    const date = new Date(event.occurredAt);
    const key = localDayKey(date);
    const current = days.at(-1);
    if (current?.key === key) current.events.push(event);
    else days.push({ key, label: dayLabel(date, now), events: [event] });
  }
  return days;
}

function dayLabel(date: Date, now: number): string {
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (localDayKey(date) === localDayKey(today)) return 'Today';
  if (localDayKey(date) === localDayKey(yesterday)) return 'Yesterday';
  return (date.getFullYear() === today.getFullYear() ? thisYearsDate : otherYearsDate).format(date);
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
