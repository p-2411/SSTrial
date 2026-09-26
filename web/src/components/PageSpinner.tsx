import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A page that isn't ready to show yet (the sign-in being checked, a page's code still loading): a
 * spinner in the middle of the space it will fill. `className` sizes that space.
 */
export function PageSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('grid place-content-center', className)} role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
    </div>
  );
}
