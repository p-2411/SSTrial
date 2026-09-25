import { useCallback, useEffect, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DETAIL_TITLE_ID, UploadDetailView } from './UploadDetailView';

/**
 * One upload's details in a panel beside the list. Opening it slides it in and narrows the list to
 * make room rather than covering it, so the list stays usable: clicking another row just swaps
 * what the panel shows.
 *
 * The URL drives it: /uploads/:id opens it, so links, refresh and the back button work. Closing it
 * (the × or Esc) goes back to the list, keeping the status filter.
 *
 * Must sit in a size container (@container): its width is a share of that container's width.
 */
export function UploadDetailPanel() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const id = useMatch('/uploads/:id')?.params.id;
  const open = Boolean(id);

  // Keep showing the last upload while the panel slides closed (the route has already changed);
  // it's cleared once the closing animation ends.
  const [shownId, setShownId] = useState(id);
  if (id && id !== shownId) setShownId(id);

  const close = useCallback(() => navigate({ pathname: '/', search }), [navigate, search]);

  // Esc closes the panel, unless an open menu or popover (e.g. Export) is handling it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <aside
      aria-labelledby={shownId ? DETAIL_TITLE_ID : undefined}
      // Closed but still rendered (mid-animation): keep it out of the tab order and accessibility tree.
      inert={!open}
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget) setShownId(undefined);
      }}
      className={cn(
        'relative shrink-0 overflow-hidden border-l bg-background shadow-[-12px_0_24px_-16px_rgb(0_0_0/0.12)]',
        'transition-[width] duration-300 ease-out motion-reduce:transition-none',
        open ? 'w-[min(42rem,55cqw)]' : 'w-0 border-transparent shadow-none',
      )}
    >
      {shownId && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-5 right-5 z-10 text-muted-foreground"
            onClick={close}
            aria-label="Close details"
          >
            <X aria-hidden />
          </Button>
          {/* Fixed at the open width, so content doesn't reflow while the panel animates. */}
          <div className="h-full w-[min(42rem,55cqw)] overflow-y-auto p-6">
            <UploadDetailView id={shownId} />
          </div>
        </>
      )}
    </aside>
  );
}
