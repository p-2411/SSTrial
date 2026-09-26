import { useCallback, useMemo, useState } from 'react';

export interface Selection {
  /** The picked IDs still listed, in the list's order. */
  selected: string[];
  isSelected: (id: string) => boolean;
  /** Picks or unpicks one. Stable, so memoised rows needn't re-render when another is picked. */
  toggle: (id: string, picked: boolean) => void;
  /** Whether every listed one is picked. */
  allSelected: boolean;
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
    allSelected: listedIds.length > 0 && selected.length === listedIds.length,
    setAll: (on) => setPicked(new Set(on ? listedIds : [])),
    clear: () => setPicked(new Set()),
  };
}
