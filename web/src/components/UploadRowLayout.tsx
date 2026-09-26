/**
 * The layout every row in the upload list shares — files still being sent from this browser and
 * the server's uploads alike — so both kinds line up in one list.
 */
export const rowClassName = 'flex items-start gap-3 border-b border-border/70 px-4 py-3 last:border-b-0';

/**
 * A row's first line: its name in bold, with smaller details (file type, size) right after it. The
 * name gives way first, down to nothing; only then do the details, so in a very narrow list they end
 * in an ellipsis too rather than being cut off mid-word.
 */
export function RowTitle({ name, meta }: { name: string; meta: string }) {
  return (
    <p className="flex min-w-0 items-baseline gap-2">
      {/* Shrinks 100 times faster, so it takes nearly all the squeeze. (Slowing the details down
          instead fails: an item shrinking at under 1 never gives up all the space it must.) */}
      <span className="min-w-0 shrink-100 truncate text-sm font-semibold" title={name}>
        {name}
      </span>
      <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
    </p>
  );
}
