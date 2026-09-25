import { SUPPORTED_FILE_TYPES, type SupportedMimeType } from '@label-extractor/shared';

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });
const absolute = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

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
  return new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

/** "PNG", "PDF"… */
export function fileTypeLabel(mimeType: SupportedMimeType): string {
  return SUPPORTED_FILE_TYPES[mimeType]?.label ?? mimeType;
}
