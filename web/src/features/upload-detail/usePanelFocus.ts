import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { uploadPath } from '@/routes';

/**
 * Where focus goes as the detail panel opens, switches upload and closes, for keyboard and screen
 * reader users. Opening an upload moves focus to its title (the ref this returns goes on it), so
 * they land on what they opened. Closing puts focus back on what opened it (the list row, or a
 * link to it) when focus was in the panel, rather than losing it to the page as the panel goes
 * inert. Focus that's elsewhere by then (a dialog, the search box) is left alone.
 */
export function usePanelFocus(openId: string | undefined, panel: RefObject<HTMLElement | null>) {
  const opener = useRef<HTMLElement | null>(null);
  const title = useRef<HTMLElement | null>(null);
  const shownId = useRef<string | undefined>(undefined);
  // Opened, but its title isn't there yet (still loading): focus it when it arrives.
  const titlePending = useRef(false);

  useLayoutEffect(() => {
    const previous = shownId.current;
    shownId.current = openId;
    if (openId === previous) return;

    const active = document.activeElement;
    // Nowhere in particular, or in the panel (and so about to be lost with it, if it's closing).
    const focusIsOurs = !(active instanceof HTMLElement) || active === document.body || panel.current?.contains(active) === true;
    if (openId) {
      // Opened, or switched to another upload: remember what did it (a row, a link).
      if (!focusIsOurs) opener.current = active;
      if (title.current?.isConnected) title.current.focus({ preventScroll: true });
      else titlePending.current = true;
      return;
    }

    // Closed.
    titlePending.current = false;
    if (focusIsOurs && previous) {
      const back = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>(`a[href="${uploadPath(previous)}"]`);
      back?.focus();
    }
    opener.current = null;
  }, [openId, panel]);

  return useCallback((node: HTMLElement | null) => {
    title.current = node;
    if (node && titlePending.current) {
      titlePending.current = false;
      node.focus({ preventScroll: true });
    }
  }, []);
}
