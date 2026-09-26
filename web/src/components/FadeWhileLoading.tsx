import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * While a new search or filter loads, the last results stay, faded, rather than blinking out (a
 * paged list's placeholder data: see cursorPaged).
 */
export function FadeWhileLoading({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <div aria-busy={loading || undefined} className={cn('transition-opacity', loading && 'opacity-60')}>
      {children}
    </div>
  );
}
