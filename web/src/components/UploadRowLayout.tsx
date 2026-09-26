/**
 * The layout every row in the upload list shares — files still being sent from this browser and
 * the server's uploads alike — so both kinds line up in one list.
 */
export const rowClassName = 'flex items-start gap-3 border-b border-border/70 px-4 py-3 last:border-b-0';

/**
 * A row's first line: its name in bold, with smaller details (file type, size) right after it. The
 * name truncates first; if even the details don't fit, they're clipped at the line's edge rather
 * than spilling into the status beside it.
 */
export function RowTitle({ name, meta }: { name: string; meta: string }) {
  return (
    <p className="flex min-w-0 items-baseline gap-2 overflow-hidden">
      <span className="truncate text-sm font-semibold" title={name}>
        {name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
    </p>
  );
}
