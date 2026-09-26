import { memo, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DETAIL_TITLE_ID, DetailFailed, UploadDetailView } from './UploadDetailView';
import { useCloseDetail, useOpenUploadId } from './useOpenUpload';
import { usePanelFocus } from './usePanelFocus';
import { usePanelResize } from './usePanelResize';

/**
 * One upload's details in a panel beside the list. Opening it slides it in and narrows the list to
 * make room rather than covering it, so the list stays usable: clicking another row just swaps
 * what the panel shows. Where there isn't room for both (under 44rem: a narrow or split-screen
 * window), it covers the list instead, at full width, so neither is squeezed.
 *
 * The URL drives it (see useOpenUploadId): closing it (the × or Esc) goes back to the list. Focus
 * follows it in and back out (see usePanelFocus). Its left edge can be dragged to widen it (see
 * usePanelResize); the default width is also the minimum.
 *
 * Must sit in a size container named `uploads` (@container/uploads): its width is a share of that
 * container's width, and the container's width decides whether it covers the list.
 *
 * Memoised: it takes no props, so it re-renders only for its own state and route changes, not each
 * time the list around it updates (upload progress, the clock).
 */
export const UploadDetailPanel = memo(function UploadDetailPanel() {
  const close = useCloseDetail();
  const id = useOpenUploadId();
  const open = Boolean(id);
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = usePanelFocus(id, panelRef);
  const { width, resizing, handleProps } = usePanelResize(panelRef);

  // Keep showing the last upload while the panel slides closed (the route has already changed);
  // it's cleared once the closing animation ends.
  const [shownId, setShownId] = useState(id);
  if (id && id !== shownId) setShownId(id);

  // Esc closes the panel, unless an open menu or popover (e.g. Export) is handling it. As an effect
  // event it always calls the latest `close`, so the listener isn't re-attached on every render.
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
      ref={panelRef}
      aria-labelledby={shownId ? DETAIL_TITLE_ID : undefined}
      // Closed but still rendered (mid-animation): keep it out of the tab order and accessibility tree.
      inert={!open}
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget) setShownId(undefined);
      }}
      data-open={open}
      style={{ '--panel-width': width } as CSSProperties}
      className={cn(
        'relative w-0 shrink-0 overflow-hidden border-l bg-background shadow-[-12px_0_24px_-16px_rgb(0_0_0/0.12)] data-[open=true]:w-(--panel-width)',
        // Too narrow for the list and the panel side by side: the panel covers the list.
        '@max-[44rem]/uploads:absolute @max-[44rem]/uploads:inset-y-0 @max-[44rem]/uploads:right-0 @max-[44rem]/uploads:z-30 @max-[44rem]/uploads:data-[open=true]:w-full',
        // Slides open and closed, but follows a drag directly.
        !resizing && 'transition-[width] duration-300 ease-out motion-reduce:transition-none',
        !open && 'border-transparent shadow-none',
      )}
    >
      {shownId && (
        <>
          {/* The drag handle: the panel's left edge, a little wider than it looks. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize details panel"
            tabIndex={0}
            title="Drag to resize. Double-click to reset."
            {...handleProps}
            className={cn(
              'absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize transition-colors outline-none @max-[44rem]/uploads:hidden',
              'hover:bg-brand/30 focus-visible:bg-brand/40',
              resizing && 'bg-brand/40',
            )}
          />
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
          {/* 12px at the bottom: the floating Submit button (SubmitToProducts) keeps that distance
              whether floating or at the end. Never a sideways scrollbar: in a narrow panel one
              showed up under everything, as extra space. */}
          <div className="h-full w-(--panel-width) overflow-x-hidden overflow-y-auto px-6 pt-6 pb-3 [scrollbar-gutter:stable] @max-[44rem]/uploads:w-[100cqw]">
            {/* One upload failing to render breaks only this panel, and the next upload starts afresh. */}
            <ErrorBoundary key={shownId} fallback={(retry) => <DetailFailed onRetry={retry} titleRef={titleRef} />}>
              <UploadDetailView id={shownId} titleRef={titleRef} />
            </ErrorBoundary>
          </div>
        </>
      )}
    </aside>
  );
});
