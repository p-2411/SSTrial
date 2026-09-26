import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Where a preview will be while it loads: a grey box in the file's usual shape, with a spinner, so
 * the whole card shows at once rather than growing when the picture arrives.
 */
export function PreviewPlaceholder({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading preview" className={cn('grid w-full place-items-center bg-muted text-muted-foreground', className)}>
      <Loader2 className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
    </div>
  );
}
