import type { ReactNode } from 'react';

/**
 * A card's list, scrolling once it's taller than about six rows (the last one cut off, so it's
 * plain there's more), so a card never grows without end: what's above it stays put and what's
 * below stays in view. Your uploads' tabs and Products both use it, with their "Load more" inside.
 */
export function ScrollingList({ children }: { children: ReactNode }) {
  return <div className="max-h-[27.5rem] overflow-y-auto [scrollbar-gutter:stable]">{children}</div>;
}
