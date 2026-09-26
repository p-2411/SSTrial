import { formatBytes, SUPPORTED_FILE_TYPES, type SupportedMimeType } from '@label-extractor/shared';

// Formatters are built once: creating one is far slower than using it, and these run for every row
// on every render.
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });
const absolute = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const full = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
const fullWithSeconds = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' });
const timeOfDay = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const dateAndTime = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "just now", "3 minutes ago", "2 hours ago", then an absolute date for anything older than a day. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 60 * 60) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 60 * 60 * 24) return relative.format(Math.round(seconds / 3600), 'hour');
  return absolute.format(new Date(iso));
}

/** Full date and time, for tooltips next to relative times. */
export function formatDateTime(iso: string): string {
  return full.format(new Date(iso));
}

/** "14:05:09". For logs, where events seconds apart need telling apart. */
export function formatTimeOfDay(iso: string): string {
  return timeOfDay.format(new Date(iso));
}

/** "Sep 25, 14:05". When something happened, for a history that spans days. */
export function formatDateAndTime(iso: string): string {
  return dateAndTime.format(new Date(iso));
}

/** Full date and time to the second, for tooltips on log times. */
export function formatDateTimeWithSeconds(iso: string): string {
  return fullWithSeconds.format(new Date(iso));
}

/** "PNG", "PDF"… */
export function fileTypeLabel(mimeType: SupportedMimeType): string {
  return SUPPORTED_FILE_TYPES[mimeType]?.label ?? mimeType;
}

/** "PNG, 48.8 KB". Just the size when there's no supported type, e.g. a file rejected in the browser. */
export function formatFileFacts(mimeType: SupportedMimeType | null, sizeBytes: number): string {
  return mimeType ? `${fileTypeLabel(mimeType)}, ${formatBytes(sizeBytes)}` : formatBytes(sizeBytes);
}

/** 45 → "45s", 190 → "3 min", 7500 → "2 h 5 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** A value the server may not have yet (nothing measured), formatted, or a dash in its place. */
export function formatOptional<T>(value: T | null, format: (value: T) => string): string {
  return value === null ? '–' : format(value);
}

/** "1 product", "3 products". */
export function productCount(count: number): string {
  return `${count} ${count === 1 ? 'product' : 'products'}`;
}
