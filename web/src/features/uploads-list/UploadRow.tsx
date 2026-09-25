import { NavLink, useLocation } from 'react-router';
import { formatBytes, type UploadSummary } from '@label-extractor/shared';
import { FileTypeTile } from '@/components/FileTypeTile';
import { StatusPill } from '@/components/StatusPill';
import { fileTypeLabel, formatDateTime, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Shared by UploadRow and PendingUploadRow so both kinds of row line up in one list. */
export const rowClassName = 'flex items-start gap-3 border-b border-border/70 px-4 py-3 last:border-b-0';

/** One server-side upload. The whole row links to its detail view. */
export function UploadRow({ upload, now }: { upload: UploadSummary; now: number }) {
  const { search } = useLocation();
  return (
    <li className="border-b border-border/70 last:border-b-0">
      <NavLink
        // Keep the current filter (?status=…) when opening an upload.
        to={{ pathname: `/uploads/${upload.id}`, search }}
        className={({ isActive }) =>
          cn(
            rowClassName,
            'border-b-0 text-inherit no-underline transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted',
            // The open upload gets an indigo marker, like the active item in SupplyScope's lists.
            isActive && 'bg-brand-soft/70 shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-soft/70',
          )
        }
      >
        <FileTypeTile mimeType={upload.mimeType} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={upload.fileName}>
            {upload.fileName}
          </p>
          <StatusDetail upload={upload} />
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {fileTypeLabel(upload.mimeType)}, {formatBytes(upload.sizeBytes)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusPill status={upload.status} />
          <time className="text-xs text-muted-foreground tabular-nums" dateTime={upload.createdAt} title={formatDateTime(upload.createdAt)}>
            {formatRelativeTime(upload.createdAt, now)}
          </time>
        </div>
      </NavLink>
    </li>
  );
}

/** The second line: what's happening, what was found, or why it failed. */
export function StatusDetail({ upload }: { upload: UploadSummary }) {
  const base = 'mt-0.5 text-sm';
  switch (upload.status) {
    case 'completed':
      return <p className={cn(base, 'font-medium text-success')}>{upload.productName ?? 'Label read'}</p>;
    case 'failed':
      return <p className={cn(base, 'text-danger')}>{upload.error?.message ?? 'Processing failed.'}</p>;
    case 'processing':
      return (
        <p className={cn(base, 'text-brand')}>
          {upload.attempts > 1 ? `Reading label, attempt ${upload.attempts} of ${upload.maxAttempts}` : 'Reading label'}
        </p>
      );
    case 'queued':
      // Queued again after a failed attempt: say why, and that it's handled.
      return upload.error ? (
        <p className={cn(base, 'text-warning')}>{upload.error.message} Retrying automatically.</p>
      ) : (
        <p className={cn(base, 'text-muted-foreground')}>Waiting to be processed</p>
      );
    case 'uploading':
      return <p className={cn(base, 'text-muted-foreground')}>Uploading</p>;
  }
}
