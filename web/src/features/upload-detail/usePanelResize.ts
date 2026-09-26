import { useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

/**
 * The open panel's default width, which is also the narrowest it can be dragged to: a share of the
 * container's, capped so text lines stay readable.
 */
const DEFAULT_WIDTH = 'min(42rem, 55cqw)';
/**
 * However wide the panel is dragged, the list beside it keeps at least this much: enough for its
 * cards' headers on one line and a readable name in each row.
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
 * Widening the panel by its left edge: dragged (moving left widens it), or moved with the arrow
 * keys, Home or a double-click putting it back to the default. The width chosen lasts while the
 * app is open, so each upload opens at it. `handleProps` go on the edge's drag handle; `resizing`
 * is true mid-drag, when the panel should follow the pointer rather than animate.
 */
export function usePanelResize(panel: RefObject<HTMLElement | null>) {
  // null: the default width.
  const [chosenWidth, setChosenWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);

  const startResize = (event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.current!.getBoundingClientRect().width;
    setResizing(true);
    const move = (moveEvent: globalThis.PointerEvent) => setChosenWidth(Math.round(startWidth + startX - moveEvent.clientX));
    const stop = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const resizeByKey = (event: KeyboardEvent) => {
    const current = panel.current!.getBoundingClientRect().width;
    if (event.key === 'ArrowLeft') setChosenWidth(current + KEYBOARD_STEP_PX);
    else if (event.key === 'ArrowRight') setChosenWidth(current - KEYBOARD_STEP_PX);
    else if (event.key === 'Home') setChosenWidth(null);
    else return;
    event.preventDefault();
  };

  return {
    width: panelWidth(chosenWidth),
    resizing,
    handleProps: { onPointerDown: startResize, onKeyDown: resizeByKey, onDoubleClick: () => setChosenWidth(null) },
  };
}
