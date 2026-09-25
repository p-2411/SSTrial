import { ChevronRight, Copy } from 'lucide-react';
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
    // min-w-0: as a grid item this would otherwise grow to fit the longest JSON line.
    <Collapsible className="group/json min-w-0">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          {/* Points right when collapsed, down when open. */}
          <ChevronRight className="transition-transform group-data-[state=open]/json:rotate-90" aria-hidden />
          Structured data (JSON)
        </Button>
      </CollapsibleTrigger>
      {/* The copy button sits inside the JSON box, top right, so it stays attached to what it copies. */}
      <CollapsibleContent className="relative mt-2">
        <pre className="max-h-80 overflow-auto rounded-lg border bg-card p-3 pr-24 text-xs leading-relaxed">{json}</pre>
        <Button
          variant="outline"
          size="sm"
          className="absolute top-2 right-2 bg-card hover:bg-muted"
          onClick={() => void copy()}
        >
          <Copy data-icon="inline-start" aria-hidden />
          Copy
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
