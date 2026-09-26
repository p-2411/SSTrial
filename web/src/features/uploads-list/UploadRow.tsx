import { memo } from 'react';
import { NavLink } from 'react-router';
import { isActiveStatus, type UploadSummary } from '@label-extractor/shared';
import { FileTypeTile } from '@/components/FileTypeTile';
import { RelativeTime } from '@/components/RelativeTime';
import { StatusPill } from '@/components/StatusPill';
import { Checkbox } from '@/components/ui/checkbox';
import { rowClassName, RowTitle } from '@/components/UploadRowLayout';
import { formatFileFacts } from '@/lib/format';
import { uploadState } from '@/lib/uploadState';
import { cn } from '@/lib/utils';
import { uploadPath } from '@/routes';

/**
 * One server-side upload, in two lines. Once the label is read, the product is what people are
 * looking for, so its name leads and the file name drops to the second line; until then the file
 * name leads and the second line says what's happening. A finished or failed upload's row links to
 * its detail view; one still being worked on has nothing to open yet, so it isn't a link.
 *
 * In a list that can act on several at once, `onSelect` gives the row a checkbox, beside the link
 * rather than in it (a control can't sit inside a link).
 *
 * Memoised: the list re-renders whenever anything in it changes (a status, an upload's progress),
 * but React Query keeps unchanged uploads as the same objects, so only changed rows re-render.
 */
export const UploadRow = memo(function UploadRow({
  upload,
  now,
  selected = false,
  onSelect,
}: {
  upload: UploadSummary;
  now: number;
  selected?: boolean;
  /** Picks or unpicks this row; stable, so picking one row doesn't re-render the others. */
  onSelect?: (id: string, picked: boolean) => void;
}) {
  const productName = upload.status === 'completed' ? upload.productName : null;
  const content = (
    <>
      <FileTypeTile mimeType={upload.mimeType} />
      <div className="min-w-0 flex-1">
        <RowTitle name={productName ?? upload.fileName} meta={formatFileFacts(upload.mimeType, upload.sizeBytes)} />
        {productName ? (
          <p className="mt-0.5 truncate text-sm text-muted-foreground" title={upload.fileName}>
            {upload.fileName}
          </p>
        ) : (
          <StatusDetail upload={upload} />
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {/* A completed upload's pill also says whether it's worth checking ("Check (72%)"). */}
        <StatusPill status={upload.status} confidence={upload.confidence} inReview={upload.submittedAt === null} />
        <RelativeTime className="text-xs text-muted-foreground tabular-nums" iso={upload.createdAt} now={now} />
      </div>
    </>
  );
  return (
    // content-visibility: the browser skips laying out rows scrolled out of view, which keeps a long
    // list (after several "Load more"s) cheap. The intrinsic size is roughly one row's height.
    <li
      className={cn(
        'border-b border-border/70 [contain-intrinsic-size:auto_4.25rem] [content-visibility:auto] last:border-b-0',
        onSelect && 'flex',
        selected && 'bg-muted/50',
      )}
    >
      {onSelect && (
        // The whole strip left of the row picks it, not just the box. Lined up with the file tile.
        <label className="flex cursor-pointer pt-[1.375rem] pl-4">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(upload.id, checked === true)}
            aria-label={`Select ${productName ?? upload.fileName}`}
          />
        </label>
      )}
      {isActiveStatus(upload.status) ? (
        <div className={cn(rowClassName, 'border-b-0', onSelect && 'min-w-0 flex-1 pl-3')}>{content}</div>
      ) : (
        <NavLink
          to={uploadPath(upload.id)}
          className={({ isActive }) =>
            cn(
              rowClassName,
              'border-b-0 text-inherit no-underline transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted',
              onSelect && 'min-w-0 flex-1 pl-3',
              // The open upload gets an indigo marker, like the active item in SupplyScope's lists.
              isActive && 'bg-brand-soft/70 shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-soft/70',
            )
          }
        >
          {content}
        </NavLink>
      )}
    </li>
  );
});

/**
 * The second line when there's no product name to lead with: what's happening, or why it failed.
 * Kept to one line; the full message is in the tooltip and the detail panel.
 */
function StatusDetail({ upload }: { upload: UploadSummary }) {
  const line = (text: string, tone: string) => (
    <p className={cn('mt-0.5 truncate text-sm', tone)} title={text}>
      {text}
    </p>
  );
  const state = uploadState(upload);
  switch (state.kind) {
    case 'unreadable':
      return line("Saved result can't be displayed. Run it again to replace it.", 'text-warning');
    case 'completed':
      // Read fine, but the label had no product name to lead with.
      return line('No product name on label', 'text-muted-foreground');
    case 'failed':
      return line(state.error?.message ?? 'Processing failed.', 'text-danger');
    case 'processing':
      return line('Reading label', 'text-brand');
    case 'retrying':
      // Queued again after a failed attempt: say why, and that it's handled.
      return line(`${state.error.message} Retrying automatically.`, 'text-warning');
    case 'waiting':
      return line('Waiting to be processed', 'text-muted-foreground');
    case 'uploading':
      return line('Uploading', 'text-muted-foreground');
  }
}
