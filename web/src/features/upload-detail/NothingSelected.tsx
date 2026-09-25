import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';

/** Route: / — shown in the detail pane before an upload is picked. */
export function NothingSelected() {
  return (
    <Card className="items-center gap-3 border-dashed px-8 py-14 text-center shadow-none">
      <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <p className="font-semibold">Select an upload</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        See the product name, brand, net weight, allergens and ingredients the AI agent read from its label, next to the
        original file.
      </p>
    </Card>
  );
}
