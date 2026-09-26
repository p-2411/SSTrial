import { rowClassName } from '@/components/UploadRowLayout';
import { Skeleton } from '@/components/ui/skeleton';

/** Rows' outlines while a list's first page loads. `label` says what's loading, to screen readers. */
export function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={rowClassName}>
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}
