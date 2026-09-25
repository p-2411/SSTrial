import { formatBytes, mimeTypeFromFileName } from '@label-extractor/shared';
import { FileTypeTile } from '@/components/FileTypeTile';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { PendingUpload } from './useFileUploads';
import { rowClassName } from '@/features/uploads-list/UploadRow';

interface PendingUploadRowProps {
  upload: PendingUpload;
  onRetry: (upload: PendingUpload) => void;
  onDismiss: (localId: string) => void;
}

/** A file still on its way to the server: progress while sending, the reason if it failed. */
export function PendingUploadRow({ upload, onRetry, onDismiss }: PendingUploadRowProps) {
  const { file, phase } = upload;
  const hasError = phase === 'rejected' || phase === 'failed';
  const mimeType = mimeTypeFromFileName(file.name) ?? 'image/png';

  return (
    <li className={rowClassName}>
      <FileTypeTile mimeType={mimeType} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={file.name}>
          {file.name}
        </p>
        {hasError ? (
          <>
            <p role="alert" className="mt-0.5 text-sm text-danger">
              {phase === 'rejected' ? upload.error : `Upload failed: ${upload.error}`}
            </p>
            <div className="mt-2 flex gap-2">
              {phase === 'failed' && (
                <Button size="xs" variant="outline" onClick={() => onRetry(upload)}>
                  Try again
                </Button>
              )}
              <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onDismiss(upload.localId)}>
                Dismiss
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-1 space-y-1.5">
            <p className="text-sm text-muted-foreground">{phaseText(upload)}</p>
            <Progress
              aria-label={`Uploading ${file.name}`}
              value={phase === 'uploading' ? Math.round(upload.progress * 100) : phase === 'confirming' ? 100 : 0}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <StatusPill status={hasError ? 'failed' : 'uploading'} />
        <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>
      </div>
    </li>
  );
}

function phaseText({ phase, progress }: PendingUpload): string {
  switch (phase) {
    case 'waiting':
      return 'Waiting to upload';
    case 'uploading':
      return `Uploading ${Math.round(progress * 100)}%`;
    case 'confirming':
      return 'Checking file';
    default:
      return '';
  }
}
