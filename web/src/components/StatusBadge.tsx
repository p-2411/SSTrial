import type { UploadStatus } from '@label-extractor/shared';
import { cx } from '../lib/cx.ts';
import styles from './StatusBadge.module.css';

const LABELS: Record<UploadStatus, string> = {
  uploading: 'Uploading',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

/** Status as icon + word. Never colour alone, so it reads for colour-blind users too. */
export function StatusBadge({ status }: { status: UploadStatus }) {
  return (
    <span className={cx(styles.badge, styles[status])}>
      <StatusIcon status={status} />
      {LABELS[status]}
    </span>
  );
}

function StatusIcon({ status }: { status: UploadStatus }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true } as const;
  switch (status) {
    case 'completed':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'processing':
    case 'uploading':
      return (
        <svg {...common} className={styles.spin}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'queued':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="3 2.2" />
        </svg>
      );
  }
}
