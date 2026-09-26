import { errorMessage } from '@/api/client';
import { rowClassName } from '@/components/UploadRowLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';

/** A refresh failed but the list still has data: keep showing it, and say it may be out of date. */
export function StaleListBanner({ error }: { error: Error | null }) {
  return (
    <p role="status" className={cn('border-b px-4 py-2 text-sm', TONE_CLASSES.warning)}>
      Couldn't refresh the list, so statuses may be out of date. {errorMessage(error)}
    </p>
  );
}

export function ListSkeleton({ label }: { label: string }) {
  return (
    <ul aria-label={label}>
      {[0, 1, 2].map((i) => (
        <li key={i} className={rowClassName}>
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
