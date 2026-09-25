import { formatDateTime, formatRelativeTime } from '@/lib/format';

/**
 * "3 minutes ago", with the full date and time on hover. `now` comes from the caller's useNow(), so
 * a list of these shares one timer instead of running one each.
 */
export function RelativeTime({ iso, now, className }: { iso: string; now: number; className?: string }) {
  return (
    <time className={className} dateTime={iso} title={formatDateTime(iso)}>
      {formatRelativeTime(iso, now)}
    </time>
  );
}
