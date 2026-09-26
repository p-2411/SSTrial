import { useCallback, useMemo, useState } from 'react';

export interface Selection {
  /** The picked IDs still listed, in the list's order. */
  selected: string[];
  isSelected: (id: string) => boolean;
  /** Picks or unpicks one. Stable, so memoised rows needn't re-render when another is picked. */
  toggle: (id: string, picked: boolean) => void;
  /** For a "select all" box: every listed one picked, some, or none. */
  all: boolean | 'indeterminate';
  /** Picks every listed one, or none. */
  setAll: (picked: boolean) => void;
  clear: () => void;
}

/**
 * Which rows of a list are picked for a batch action. Only rows still listed count: one that
 * leaves the list (submitted, deleted, filtered out) stops being selected, so an action never
 * reaches something that's no longer on screen.
 */
export function useSelection(listedIds: readonly string[]): Selection {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const selected = useMemo(() => listedIds.filter((id) => picked.has(id)), [listedIds, picked]);

  const toggle = useCallback((id: string, on: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return {
    selected,
    isSelected: (id) => picked.has(id),
    toggle,
    all: selected.length === 0 ? false : selected.length === listedIds.length ? true : 'indeterminate',
    setAll: (on) => setPicked(new Set(on ? listedIds : [])),
    clear: () => setPicked(new Set()),
  };
}
