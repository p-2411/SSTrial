import { memo, useEffect, useEffectEvent, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HOME_PATH, UPLOAD_PATH_PATTERN } from '@/routes';
import { DETAIL_TITLE_ID, UploadDetailView } from './UploadDetailView';

/** The open panel's width: a share of the container's, capped so text lines stay readable. */
const OPEN_WIDTH = 'w-[min(42rem,55cqw)]';

/**
 * One upload's details in a panel beside the list. Opening it slides it in and narrows the list to
 * make room rather than covering it, so the list stays usable: clicking another row just swaps
 * what the panel shows.
 *
 * The URL drives it: /uploads/:id opens it, so links, refresh and the back button work. Closing it
 * (the × or Esc) goes back to the list, keeping the status filter.
 *
 * Must sit in a size container (@container): its width is a share of that container's width.
 *
 * Memoised: it takes no props, so it re-renders only for its own state and route changes, not each
 * time the list around it updates (upload progress, the clock).
 */
export const UploadDetailPanel = memo(function UploadDetailPanel() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const id = useMatch(UPLOAD_PATH_PATTERN)?.params.id;
  const open = Boolean(id);

  // Keep showing the last upload while the panel slides closed (the route has already changed);
  // it's cleared once the closing animation ends.
  const [shownId, setShownId] = useState(id);
  if (id && id !== shownId) setShownId(id);

  const close = () => navigate({ pathname: HOME_PATH, search });

  // Esc closes the panel, unless an open menu or popover (e.g. Export) is handling it. As an effect
  // event it always sees the latest filter, so the listener isn't re-attached when the filter changes.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
    close();
  });
  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

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
        open ? OPEN_WIDTH : 'w-0 border-transparent shadow-none',
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
          {/* Fixed at the open width, so content doesn't reflow while the panel animates. The
              scrollbar's space is reserved too, so short and long uploads line up the same. */}
          <div className={cn('h-full overflow-y-auto p-6 [scrollbar-gutter:stable]', OPEN_WIDTH)}>
            <UploadDetailView id={shownId} />
          </div>
        </>
      )}
    </aside>
  );
});
