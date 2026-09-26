import { Button } from '@/components/ui/button';
import type { Selection } from '@/lib/useSelection';

/** Ticks every row a tab lists, or none: a tertiary action, plain text underlined on hover. */
export function SelectAllButton({ selection }: { selection: Selection }) {
  return (
    <Button variant="link" size="sm" className="px-1 font-medium" onClick={() => selection.setAll(!selection.allSelected)}>
      {selection.allSelected ? 'Deselect all' : 'Select all'}
    </Button>
  );
}
