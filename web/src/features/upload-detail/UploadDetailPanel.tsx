import {
  memo,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HOME_PATH, UPLOAD_PATH_PATTERN } from '@/routes';
import { DETAIL_TITLE_ID, DetailFailed, UploadDetailView } from './UploadDetailView';

/**
 * The open panel's default width, which is also the narrowest it can be dragged to: a share of the
 * container's, capped so text lines stay readable.
 */
const DEFAULT_WIDTH = 'min(42rem, 55cqw)';
/**
 * However wide the panel is dragged, the list beside it keeps at least this much: enough for its
 * status tabs on one line and a readable name in each row.
 */
const LIST_MIN_WIDTH = '30rem';
/** How far an arrow key moves the panel's edge. */
const KEYBOARD_STEP_PX = 32;

/**
 * The panel's width in CSS: the default, or a width someone dragged it to. Written as a clamp, so
 * it stays within bounds even when the window is resized afterwards.
 */
export function panelWidth(chosenPx: number | null): string {
  return chosenPx === null ? DEFAULT_WIDTH : `clamp(${DEFAULT_WIDTH}, ${chosenPx}px, max(${DEFAULT_WIDTH}, calc(100cqw - ${LIST_MIN_WIDTH})))`;
}

/**
 * One upload's details in a panel beside the list. Opening it slides it in and narrows the list to
 * make room rather than covering it, so the list stays usable: clicking another row just swaps
 * what the panel shows.
 *
 * The URL drives it: /uploads/:id opens it, so links, refresh and the back button work. Closing it
 * (the × or Esc) goes back to the list, keeping the status filter.
 *
 * Its left edge can be dragged to widen it (or moved with the arrow keys; double-click resets it).
 * The default width is also the minimum.
 *
 * Must sit in a size container (@container): its width is a share of that container's width.
 *
 * Memoised: it takes no props, so it re-renders only for its own state and route changes, not each
 * time the list around it updates (upload progress, the clock).
 */
export const UploadDetailPanel = memo(function UploadDetailPanel() {
  const close = useCloseDetail();
  const id = useMatch(UPLOAD_PATH_PATTERN)?.params.id;
  const open = Boolean(id);
  const panelRef = useRef<HTMLElement>(null);
  // null: the default width. Kept while the app is open, so each upload opens at the chosen width.
  const [chosenWidth, setChosenWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const width = panelWidth(chosenWidth);

  /** Starts a drag on the panel's left edge: moving left widens it. */
  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelRef.current!.getBoundingClientRect().width;
    setResizing(true);
    const move = (moveEvent: PointerEvent) => setChosenWidth(Math.round(startWidth + startX - moveEvent.clientX));
    const stop = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const resizeByKey = (event: ReactKeyboardEvent) => {
    const current = panelRef.current!.getBoundingClientRect().width;
    if (event.key === 'ArrowLeft') setChosenWidth(current + KEYBOARD_STEP_PX);
    else if (event.key === 'ArrowRight') setChosenWidth(current - KEYBOARD_STEP_PX);
    else if (event.key === 'Home') setChosenWidth(null);
    else return;
    event.preventDefault();
  };

  // Keep showing the last upload while the panel slides closed (the route has already changed);
  // it's cleared once the closing animation ends.
  const [shownId, setShownId] = useState(id);
  if (id && id !== shownId) setShownId(id);

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
      ref={panelRef}
      aria-labelledby={shownId ? DETAIL_TITLE_ID : undefined}
      // Closed but still rendered (mid-animation): keep it out of the tab order and accessibility tree.
      inert={!open}
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget) setShownId(undefined);
      }}
      style={{ width: open ? width : 0 } satisfies CSSProperties}
      className={cn(
        'relative shrink-0 overflow-hidden border-l bg-background shadow-[-12px_0_24px_-16px_rgb(0_0_0/0.12)]',
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
            onPointerDown={startResize}
            onDoubleClick={() => setChosenWidth(null)}
            onKeyDown={resizeByKey}
            className={cn(
              'absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize transition-colors outline-none',
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
          <div className="h-full overflow-x-hidden overflow-y-auto px-6 pt-6 pb-3 [scrollbar-gutter:stable]" style={{ width }}>
            {/* One upload failing to render breaks only this panel, and the next upload starts afresh. */}
            <ErrorBoundary key={shownId} fallback={(retry) => <DetailFailed onRetry={retry} />}>
              <UploadDetailView id={shownId} />
            </ErrorBoundary>
          </div>
        </>
      )}
    </aside>
  );
});

/** Closes the panel: back to the list, keeping its status filter. */
export function useCloseDetail(): () => void {
  const navigate = useNavigate();
  const { search } = useLocation();
  return () => void navigate({ pathname: HOME_PATH, search });
}
