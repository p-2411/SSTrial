import type { ReactNode } from 'react';

/**
 * A card's list, scrolling once it's taller than six and a half rows (--upload-row-height: the half
 * row makes it plain there's more), so a card never grows without end: what's above it stays put and what's
 * below stays in view. Your uploads' tabs and Products both use it, with their "Load more" inside.
 */
export function ScrollingList({ children }: { children: ReactNode }) {
  return <div className="max-h-[calc(var(--upload-row-height)*6.5)] overflow-y-auto [scrollbar-gutter:stable]">{children}</div>;
}
