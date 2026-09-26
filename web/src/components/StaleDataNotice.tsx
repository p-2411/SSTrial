import { errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';

interface StaleDataNoticeProps {
  /** What couldn't be refreshed, as it reads mid-sentence: "the list", "this upload". */
  what: string;
  /** Why not: the failed refresh's error. */
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  /** A band across a card by default; this adjusts it (padding, or a box of its own). */
  className?: string;
}

/**
 * A refresh failed, but what loaded before is still showing: keep it up, and say it may be out of
 * date, why, and how to try again. Only for a failed refresh; a first load that fails has nothing
 * to show, so it gets an InlineError instead.
 */
export function StaleDataNotice({ what, error, onRetry, retrying = false, className }: StaleDataNoticeProps) {
  return (
    <div role="status" className={cn('flex flex-wrap items-baseline gap-x-2 border-b px-4 py-2 text-sm', TONE_CLASSES.warning, className)}>
      <p>
        Couldn't refresh {what}, so it may be out of date. {errorMessage(error)}
      </p>
      {onRetry && (
        <Button variant="link" size="xs" className="h-auto p-0 text-sm text-current" loading={retrying} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
