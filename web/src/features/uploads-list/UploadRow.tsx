import { memo } from 'react';
import { NavLink, useLocation } from 'react-router';
import { formatBytes, type UploadSummary } from '@label-extractor/shared';
import { FileTypeTile } from '@/components/FileTypeTile';
import { StatusPill } from '@/components/StatusPill';
import { fileTypeLabel, formatDateTime, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Shared by UploadRow and PendingUploadRow so both kinds of row line up in one list. */
export const rowClassName = 'flex items-start gap-3 border-b border-border/70 px-4 py-3 last:border-b-0';

/** A row's first line: its name in bold, with smaller details (file type, size) right after it. */
export function RowTitle({ name, meta }: { name: string; meta: string }) {
  return (
    <p className="flex min-w-0 items-baseline gap-2">
      <span className="truncate text-sm font-semibold" title={name}>
        {name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
    </p>
  );
}

/**
 * One server-side upload, in two lines. Once the label is read, the product is what people are
 * looking for, so its name leads and the file name drops to the second line; until then the file
 * name leads and the second line says what's happening. The whole row links to its detail view.
 *
 * Memoised: the list re-renders whenever anything in it changes (a status, an upload's progress),
 * but React Query keeps unchanged uploads as the same objects, so only changed rows re-render.
 */
export const UploadRow = memo(function UploadRow({ upload, now }: { upload: UploadSummary; now: number }) {
  const { search } = useLocation();
  const productName = upload.status === 'completed' ? upload.productName : null;
  return (
    // content-visibility: the browser skips laying out rows scrolled out of view, which keeps a long
    // list (after several "Load more"s) cheap. The intrinsic size is roughly one row's height.
    <li className="border-b border-border/70 [contain-intrinsic-size:auto_4.25rem] [content-visibility:auto] last:border-b-0">
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
          <RowTitle
            name={productName ?? upload.fileName}
            meta={`${fileTypeLabel(upload.mimeType)}, ${formatBytes(upload.sizeBytes)}`}
          />
          {productName ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground" title={upload.fileName}>
              {upload.fileName}
            </p>
          ) : (
            <StatusDetail upload={upload} />
          )}
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
});

/**
 * The second line when there's no product name to lead with: what's happening, or why it failed.
 * Kept to one line; the full message is in the tooltip and the detail panel.
 */
export function StatusDetail({ upload }: { upload: UploadSummary }) {
  const line = (text: string, tone: string) => (
    <p className={cn('mt-0.5 truncate text-sm', tone)} title={text}>
      {text}
    </p>
  );
  switch (upload.status) {
    case 'completed':
      // No product name to lead with: either the saved result can't be read, or the label had none.
      return upload.resultUnreadable
        ? line("Saved result can't be displayed. Run it again to replace it.", 'text-warning')
        : line('No product name on label', 'text-muted-foreground');
    case 'failed':
      return line(upload.error?.message ?? 'Processing failed.', 'text-danger');
    case 'processing':
      return line('Reading label', 'text-brand');
    case 'queued':
      // Queued again after a failed attempt: say why, and that it's handled.
      return upload.error
        ? line(`${upload.error.message} Retrying automatically.`, 'text-warning')
        : line('Waiting to be processed', 'text-muted-foreground');
    case 'uploading':
      return line('Uploading', 'text-muted-foreground');
  }
}
