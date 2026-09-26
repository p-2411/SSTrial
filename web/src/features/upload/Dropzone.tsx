import { memo, useEffect, useRef, useState, type DragEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';
import {
  FILE_INPUT_ACCEPT,
  formatBytes,
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_TYPES_LABEL,
  validateFileMetadata,
  type SupportedMimeType,
} from '@label-extractor/shared';
import { FileTypeTile } from '@/components/FileTypeTile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatFileFacts } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A file picked but not yet submitted. `problem` says why it can't be uploaded, if it can't. */
interface StagedFile {
  id: string;
  file: File;
  mimeType: SupportedMimeType | null;
  problem: string | null;
}

function stage(file: File): StagedFile {
  const validation = validateFileMetadata({ name: file.name, type: file.type, size: file.size });
  return {
    id: crypto.randomUUID(),
    file,
    mimeType: validation.ok ? validation.mimeType : null,
    problem: validation.ok ? null : validation.message,
  };
}

/**
 * The drop area's one height, whether it's inviting files or listing them: the invitation's own
 * height (218px). Listed files scroll inside it, so the page below never jumps as files are added.
 */
const DROP_AREA_HEIGHT = 'h-[13.625rem]';

/** The same file picked twice (dropped again, or chosen again) is only listed once. */
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Where files come in: drag and drop, or the file picker (which is also the keyboard path). Files
 * are gathered first, listed inside the drop area where more can still be dropped, and only sent
 * on Submit. A file that can't be uploaded says why on its own card, and stays behind on Submit
 * so the reason isn't lost.
 *
 * Memoised: `onSubmit` is stable, so upload progress re-rendering the page doesn't re-render this.
 */
export const Dropzone = memo(function Dropzone({ onSubmit }: { onSubmit: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
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

  const add = (files: File[]) =>
    setStaged((current) => [...current, ...files.filter((file) => !current.some((s) => sameFile(s.file, file))).map(stage)]);
  const remove = (id: string) => setStaged((current) => current.filter((s) => s.id !== id));
  const choose = () => inputRef.current?.click();

  const ready = staged.filter((s) => s.problem === null);
  const submit = () => {
    onSubmit(ready.map((s) => s.file));
    setStaged((current) => current.filter((s) => s.problem !== null));
  };

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const isEmpty = staged.length === 0;

  return (
    <Card className="gap-2 p-2">
      <div
        className={cn(
          'rounded-lg border border-dashed border-border bg-muted/50 transition-colors',
          DROP_AREA_HEIGHT,
          isEmpty ? 'flex flex-col items-center justify-center gap-3 px-6 text-center' : 'overflow-y-auto p-2',
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
          if (event.dataTransfer.files.length > 0) add([...event.dataTransfer.files]);
        }}
      >
        {isEmpty ? (
          <>
            <span className="grid size-11 place-items-center rounded-full bg-card text-brand shadow-sm ring-1 ring-border">
              <UploadCloud className="size-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="font-semibold tracking-[-0.01em]">{isDragging ? 'Drop to add' : 'Drop label photos or PDFs here'}</p>
              <p className="text-sm text-muted-foreground">
                {SUPPORTED_TYPES_LABEL}, up to {formatBytes(MAX_FILE_SIZE_BYTES)} each.
              </p>
            </div>
            <Button size="lg" onClick={choose}>
              Choose files
            </Button>
          </>
        ) : (
          <ul aria-label="Files to upload" className="grid gap-2">
            {staged.map((s) => (
              <StagedFileCard key={s.id} staged={s} onRemove={() => remove(s.id)} />
            ))}
          </ul>
        )}
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
            if (files.length > 0) add(files);
          }}
        />
      </div>

      {!isEmpty && (
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={choose}>
            Add more files
          </Button>
          <Button onClick={submit} disabled={ready.length === 0}>
            Submit
          </Button>
        </div>
      )}
    </Card>
  );
});

/** One picked file, as a card the same shape as the drop area around it. */
function StagedFileCard({ staged: { file, mimeType, problem }, onRemove }: { staged: StagedFile; onRemove: () => void }) {
  return (
    <li className={cn('flex items-center gap-3 rounded-lg border bg-card px-3 py-2', problem && 'border-danger-border')}>
      <FileTypeTile mimeType={mimeType} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={file.name}>
          {file.name}
        </p>
        {problem ? (
          <p className="text-xs text-danger wrap-anywhere">{problem}</p>
        ) : (
          <p className="text-xs text-muted-foreground tabular-nums">{formatFileFacts(mimeType, file.size)}</p>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={`Remove ${file.name}`} onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </li>
  );
}
