import { ChevronDown, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { LabelExtraction } from '@label-extractor/shared';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/** The raw structured result, for people wiring it into other systems. Collapsed by default. */
export function JsonDisclosure({ data }: { data: LabelExtraction }) {
  const json = JSON.stringify(data, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      toast.success('JSON copied to clipboard');
    } catch {
      // Clipboard can be blocked (permissions, insecure context); the JSON is still selectable.
      toast.error("Couldn't copy. Select the JSON and copy it manually.");
    }
  }

  return (
    <Collapsible className="group/json">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ChevronDown className="transition-transform group-data-[state=open]/json:rotate-180" aria-hidden />
          Structured data (JSON)
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          <Copy data-icon="inline-start" aria-hidden />
          Copy JSON
        </Button>
        <pre className="max-h-80 overflow-auto rounded-lg border bg-card p-3 text-xs leading-relaxed">{json}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
