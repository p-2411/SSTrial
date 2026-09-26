/**
 * A span of whole days in the viewer's own time zone, as YYYY-MM-DD, both ends included; either
 * end may be open. Days, not instants, so a URL with ?from=2026-09-01 means the same day to whoever
 * opens it. Only the requests to the API turn them into instants: the viewer's own midnights.
 */
export interface DayRange {
  from: string | null;
  to: string | null;
}

export const ANY_TIME: DayRange = { from: null, to: null };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether this is a real day written as YYYY-MM-DD ("2026-02-30" isn't). */
export function isDay(value: string): boolean {
  const match = DAY.exec(value);
  return match !== null && toDay(startOfDay(value)) === value;
}

/** The day a moment falls on, where the viewer is. */
export function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight at the start of a day, where the viewer is. */
export function startOfDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
}

export function addDays(day: string, days: number): string {
  const date = startOfDay(day);
  date.setDate(date.getDate() + days);
  return toDay(date);
}

/** The instants the API filters by: from the start of the first day to the start of the day after the last. */
export function toInstants({ from, to }: DayRange): { from?: string; to?: string } {
  return {
    ...(from && { from: startOfDay(from).toISOString() }),
    ...(to && { to: startOfDay(addDays(to, 1)).toISOString() }),
  };
}

/** The spans offered with one click, counted back from today (which counts as one of the days). */
export const DAY_PRESETS: Array<{ label: string; range: (today: string) => DayRange }> = [
  { label: 'Today', range: (today) => ({ from: today, to: today }) },
  { label: 'Yesterday', range: (today) => ({ from: addDays(today, -1), to: addDays(today, -1) }) },
  { label: 'Last 7 days', range: (today) => ({ from: addDays(today, -6), to: today }) },
  { label: 'Last 30 days', range: (today) => ({ from: addDays(today, -29), to: today }) },
];

export function sameRange(a: DayRange, b: DayRange): boolean {
  return a.from === b.from && a.to === b.to;
}

const dayMonth = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Sep 3", with the year when it isn't this one. */
function formatDay(day: string, today: string): string {
  return (day.slice(0, 4) === today.slice(0, 4) ? dayMonth : dayMonthYear).format(startOfDay(day));
}

/** A range in words: "Any time", a preset's name, "Sep 3", "Sep 3 – Sep 26", "Since Sep 3", "Until Sep 26". */
export function describeDayRange(range: DayRange, today: string): string {
  const { from, to } = range;
  if (!from && !to) return 'Any time';
  const preset = DAY_PRESETS.find((candidate) => sameRange(candidate.range(today), range));
  if (preset) return preset.label;
  if (from && to) return from === to ? formatDay(from, today) : `${formatDay(from, today)} – ${formatDay(to, today)}`;
  return from ? `Since ${formatDay(from, today)}` : `Until ${formatDay(to!, today)}`;
}
