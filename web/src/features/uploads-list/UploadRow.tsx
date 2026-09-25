import { NavLink } from 'react-router';
import { formatBytes, type UploadSummary } from '@label-extractor/shared';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { cx } from '../../lib/cx.ts';
import { fileTypeLabel, formatDateTime, formatRelativeTime } from '../../lib/format.ts';
import styles from './UploadRow.module.css';

/** One server-side upload. The whole row links to its detail view. */
export function UploadRow({ upload, now }: { upload: UploadSummary; now: number }) {
  return (
    <li>
      <NavLink
        to={`/uploads/${upload.id}`}
        className={({ isActive }) => cx(styles.row, styles.link, isActive && styles.active)}
      >
        <div className={styles.status}>
          <StatusBadge status={upload.status} />
        </div>
        <div className={styles.main}>
          <p className={styles.name} title={upload.fileName}>
            {upload.fileName}
          </p>
          <StatusDetail upload={upload} />
        </div>
        <div className={styles.meta}>
          <span>
            {fileTypeLabel(upload.mimeType)}, {formatBytes(upload.sizeBytes)}
          </span>
          <time dateTime={upload.createdAt} title={formatDateTime(upload.createdAt)}>
            {formatRelativeTime(upload.createdAt, now)}
          </time>
        </div>
      </NavLink>
    </li>
  );
}

/** The second line: what's happening, what was found, or why it failed. */
export function StatusDetail({ upload }: { upload: UploadSummary }) {
  switch (upload.status) {
    case 'completed':
      return <p className={styles.found}>{upload.productName ?? 'Label read'}</p>;
    case 'failed':
      return <p className={styles.failure}>{upload.error?.message ?? 'Processing failed.'}</p>;
    case 'processing':
      return (
        <p className={styles.detail}>
          {upload.attempts > 1 ? `Reading label, attempt ${upload.attempts} of ${upload.maxAttempts}` : 'Reading label'}
        </p>
      );
    case 'queued':
      // Queued again after a failed attempt: say why, and that it's handled.
      return upload.error ? (
        <p className={styles.retrying}>{upload.error.message} Retrying automatically.</p>
      ) : (
        <p className={styles.detail}>Waiting to be processed</p>
      );
    case 'uploading':
      return <p className={styles.detail}>Uploading</p>;
  }
}
