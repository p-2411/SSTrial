import { memo } from 'react';
import { NavLink } from 'react-router';
import { isActiveStatus, type UploadSummary } from '@label-extractor/shared';
import { FileTypeTile } from '@/components/FileTypeTile';
import { RelativeTime } from '@/components/RelativeTime';
import { StatusPill } from '@/components/StatusPill';
import { Checkbox } from '@/components/ui/checkbox';
import { rowClassName, RowTitle } from '@/components/UploadRowLayout';
import { formatFileFacts } from '@/lib/format';
import { TONE_TEXT_CLASSES } from '@/lib/tone';
import { isInReview, progressLine, uploadState } from '@/lib/uploadState';
import { cn } from '@/lib/utils';
import { uploadPath } from '@/routes';

/**
 * One server-side upload, in two lines. Once the label is read, the product is what people are
 * looking for, so its name leads and the file name drops to the second line; until then the file
 * name leads and the second line says what's happening. A finished or failed upload's row links to
 * its detail view; one still being worked on has nothing to open yet, so it isn't a link.
 *
 * In a list that can act on several at once, `onSelect` gives the row a checkbox. It takes the
 * status column's place while the row is hovered (or focused from the keyboard), and stays once ticked. It sits over
 * the link rather than in it: a control can't be inside a link. The swap is instant, by opacity on
 * the whole column: hiding it with `visibility` let the pill's own transition lag behind the time,
 * so the two went one after the other and the pill briefly overlapped the box.
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
      <div
        className={cn(
          'flex flex-col items-end gap-1.5',
          onSelect && (selected ? 'opacity-0' : 'group-hover/row:opacity-0 group-has-focus-visible/row:opacity-0'),
        )}
      >
        {/* A completed upload's pill also says whether it's worth checking ("Check (72%)"). */}
        <StatusPill status={upload.status} confidence={upload.confidence} inReview={isInReview(upload)} />
        <RelativeTime className="text-xs text-muted-foreground tabular-nums" iso={upload.createdAt} now={now} />
      </div>
    </>
  );
  return (
    // content-visibility: the browser skips laying out rows scrolled out of view, which keeps a long
    // list (after several "Load more"s) cheap. The intrinsic size is roughly one row's height.
    <li
      className={cn(
        'group/row relative border-b border-border/70 [contain-intrinsic-size:auto_4.25rem] [content-visibility:auto] last:border-b-0',
        selected && 'bg-muted/50',
      )}
    >
      {isActiveStatus(upload.status) ? (
        <div className={cn(rowClassName, 'border-b-0')}>{content}</div>
      ) : (
        <NavLink
          to={uploadPath(upload.id)}
          className={({ isActive }) =>
            cn(
              rowClassName,
              'border-b-0 text-inherit no-underline transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted',
              // The open upload gets an indigo marker, like the active item in SupplyScope's lists.
              isActive && 'bg-brand-soft/70 shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-soft/70',
            )
          }
        >
          {content}
        </NavLink>
      )}
      {onSelect && (
        // Padded, so the box is easy to hit; after the link, so it's on top of it.
        <label
          className={cn(
            'absolute top-1/2 right-2 flex -translate-y-1/2 cursor-pointer p-2',
            !selected && 'opacity-0 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100',
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(upload.id, checked === true)}
            aria-label={`Select ${productName ?? upload.fileName}`}
          />
        </label>
      )}
    </li>
  );
});

/**
 * The second line when there's no product name to lead with: what's happening, or why it failed.
 * Kept to one line; the full message is in the tooltip and the detail panel.
 */
function StatusDetail({ upload }: { upload: UploadSummary }) {
  const state = uploadState(upload);
  const { text, tone } =
    state.kind === 'unreadable'
      ? { text: "Saved result can't be displayed. Run it again to replace it.", tone: 'warning' as const }
      : // Read fine, but the label had no product name to lead with.
        (progressLine(state) ?? { text: 'No product name on label', tone: 'muted' as const });
  return (
    <p className={cn('mt-0.5 truncate text-sm', TONE_TEXT_CLASSES[tone])} title={text}>
      {text}
    </p>
  );
}
