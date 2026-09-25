import { useEffect, useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import { FILE_INPUT_ACCEPT, formatBytes, MAX_FILE_SIZE_BYTES, SUPPORTED_TYPES_LABEL } from '@label-extractor/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Where files come in: drag and drop, or the file picker (which is also the keyboard path).
 * Validation happens in useFileUploads, so rejected files still get a row explaining why.
 */
export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // dragenter/dragleave fire for every child element crossed, so count depth instead of toggling.
  const dragDepth = useRef(0);

  // A file dropped just outside the zone would make the browser navigate away to open it.
  useEffect(() => {
    const preventNavigation = (event: globalThis.DragEvent) => event.preventDefault();
    window.addEventListener('dragover', preventNavigation);
    window.addEventListener('drop', preventNavigation);
    return () => {
      window.removeEventListener('dragover', preventNavigation);
      window.removeEventListener('drop', preventNavigation);
    };
  }, []);

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

  return (
    <Card className="gap-0 p-2">
      <div
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/50 px-6 py-8 text-center transition-colors',
          isDragging && 'border-brand bg-brand-soft',
        )}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          dragDepth.current += 1;
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setIsDragging(false);
          if (event.dataTransfer.files.length > 0) onFiles([...event.dataTransfer.files]);
        }}
      >
        <span className="grid size-11 place-items-center rounded-full bg-card text-brand shadow-sm ring-1 ring-border">
          <UploadCloud className="size-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="font-semibold tracking-[-0.01em]">{isDragging ? 'Drop to upload' : 'Drop label photos or PDFs here'}</p>
          <p className="text-sm text-muted-foreground">
            {SUPPORTED_TYPES_LABEL}, up to {formatBytes(MAX_FILE_SIZE_BYTES)} each. You can add several at once.
          </p>
        </div>
        <Button size="lg" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={FILE_INPUT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="file-input"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = ''; // so choosing the same file again still triggers a change
            if (files.length > 0) onFiles(files);
          }}
        />
      </div>
    </Card>
  );
}
