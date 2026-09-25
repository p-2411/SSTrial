import { formatBytes } from '@label-extractor/shared';
import { Button } from '../../components/Button.tsx';
import { ProgressBar } from '../../components/ProgressBar.tsx';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import rowStyles from '../uploads-list/UploadRow.module.css';
import type { PendingUpload } from './useFileUploads.ts';
import styles from './PendingUploadRow.module.css';

interface PendingUploadRowProps {
  upload: PendingUpload;
  onRetry: (upload: PendingUpload) => void;
  onDismiss: (localId: string) => void;
}

/** A file still on its way to the server: progress while sending, the reason if it failed. */
export function PendingUploadRow({ upload, onRetry, onDismiss }: PendingUploadRowProps) {
  const { file, phase } = upload;
  const hasError = phase === 'rejected' || phase === 'failed';

  return (
    <li className={rowStyles.row}>
      <div className={rowStyles.status}>
        {hasError ? <StatusBadge status="failed" /> : <StatusBadge status="uploading" />}
      </div>
      <div className={rowStyles.main}>
        <p className={rowStyles.name} title={file.name}>
          {file.name}
        </p>
        {hasError ? (
          <>
            <p role="alert" className={rowStyles.failure}>
              {phase === 'rejected' ? upload.error : `Upload failed: ${upload.error}`}
            </p>
            <div className={styles.actions}>
              {phase === 'failed' && (
                <Button size="sm" onClick={() => onRetry(upload)}>
                  Try again
                </Button>
              )}
              <Button size="sm" variant="quiet" onClick={() => onDismiss(upload.localId)}>
                Dismiss
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.progress}>
            <p className={rowStyles.detail}>{phaseText(upload)}</p>
            <ProgressBar
              label={`Uploading ${file.name}`}
              value={phase === 'uploading' ? upload.progress : undefined}
            />
          </div>
        )}
      </div>
      <div className={rowStyles.meta}>{formatBytes(file.size)}</div>
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
