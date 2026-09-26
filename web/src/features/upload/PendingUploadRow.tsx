import { memo } from 'react';
import { FileTypeTile } from '@/components/FileTypeTile';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { rowClassName, RowTitle } from '@/components/UploadRowLayout';
import { formatFileFacts } from '@/lib/format';
import { couldNotSend, type PendingUpload } from './useFileUploads';

interface PendingUploadRowProps {
  upload: PendingUpload;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/**
 * A file still on its way to the server, laid out like UploadRow: name, type and size on the first
 * line; progress (or why it failed) on the second.
 *
 * Memoised: when one file's progress moves, the others (same objects, stable callbacks) don't
 * re-render.
 */
export const PendingUploadRow = memo(function PendingUploadRow({ upload, onRetry, onDismiss }: PendingUploadRowProps) {
  const { file, mimeType, phase } = upload;
  const hasError = couldNotSend(upload);

  return (
    <li className={rowClassName}>
      <FileTypeTile mimeType={mimeType} />
      <div className="min-w-0 flex-1">
        <RowTitle name={file.name} meta={formatFileFacts(mimeType, file.size)} />
        {hasError ? (
          <p role="alert" className="mt-0.5 text-sm text-danger">
            {phase === 'rejected' ? upload.error : `Upload failed: ${upload.error}`}
          </p>
        ) : (
          <div className="mt-0.5 flex items-center gap-3">
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{phaseText(upload)}</span>
            <Progress
              aria-label={`Uploading ${file.name}`}
              className="flex-1"
              value={phase === 'uploading' ? Math.round(upload.progress * 100) : phase === 'confirming' ? 100 : 0}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <StatusPill status={hasError ? 'failed' : 'uploading'} />
        {/* Actions sit under the status, so a failed row stays two lines like the rest. */}
        {hasError && (
          <div className="flex gap-1">
            {phase === 'failed' && (
              <Button size="xs" variant="outline" onClick={() => onRetry(upload.localId)}>
                Try again
              </Button>
            )}
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onDismiss(upload.localId)}>
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </li>
  );
});

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
