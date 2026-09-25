import { ChevronRight, Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { LabelExtraction } from '@label-extractor/shared';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * The raw structured result, for people wiring it into other systems: copy it, or download it as
 * a .json file named after the upload. Collapsed by default.
 */
export function JsonDisclosure({ data, fileName }: { data: LabelExtraction; fileName: string }) {
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

  function download() {
    // The data is already here, so build the file in the browser rather than asking the API again.
    const url = URL.createObjectURL(new Blob([`${json}\n`], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.[^.]+$/, '')}.json`;
    link.click();
    URL.revokeObjectURL(url);
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
      {/* The actions sit inside the JSON box, top right, over space kept free for them (pt-12). */}
      <CollapsibleContent className="relative mt-2">
        {/* No inner scrolling (the detail pane already scrolls), so the buttons never sit on a scrollbar. */}
        <pre className="rounded-lg border bg-card px-3 pt-12 pb-3 text-xs leading-relaxed break-words whitespace-pre-wrap">
          {json}
        </pre>
        <div className="absolute top-2 right-2 flex gap-1.5">
          <Button variant="outline" size="sm" className="bg-card hover:bg-muted" onClick={() => void copy()}>
            <Copy data-icon="inline-start" aria-hidden />
            Copy
          </Button>
          <Button variant="outline" size="sm" className="bg-card hover:bg-muted" onClick={download}>
            <Download data-icon="inline-start" aria-hidden />
            Download
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
