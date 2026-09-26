import { ChevronRight } from 'lucide-react';
import { FIELD_LABELS, formatList, type EventDetails as Details, type FieldChange, type LabelField } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import type { EventDetailsSource } from '@/api/logs';
import { useEventDetails } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { diffLines, fieldLines, foldUnchanged, type DiffLine } from './changeLines';

/**
 * How an action on an event reads: small, quiet text with its icon first, darkening and underlined on hover.
 * "Details" and a history's "Revert" share it, so they sit side by side as equals.
 *
 * Its label goes in a <span>, which sets the action's baseline (`self-baseline`), so the label sits on
 * the same line as the event's message in the rows' baseline grids. Otherwise the icon, coming first
 * and having no baseline of its own, did: its bottom edge sat on the line, lifting the label.
 */
export const EVENT_ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-sm text-xs font-medium whitespace-nowrap text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&>span]:self-baseline [&_svg]:size-3.5 [&_svg]:shrink-0';

/**
 * "Details", beside or under an event in a list: opens its CollapsibleContent (which holds
 * EventDetails). Inside a Collapsible with `group/event`, so its chevron turns as it opens.
 */
export function EventDetailsTrigger() {
  return (
    <CollapsibleTrigger className={EVENT_ACTION_CLASS}>
      {/* Points right when collapsed, down when open. */}
      <ChevronRight className="transition-transform group-data-[state=open]/event:rotate-90" aria-hidden />
      <span>Details</span>
    </CollapsibleTrigger>
  );
}

/**
 * An event's details, fetched when this first shows (it's only mounted once opened): lists leave
 * them out, and most are never opened. What a change did to the data, the data as read, or the
 * event's facts.
 */
export function EventDetails({ source, eventId }: { source: EventDetailsSource; eventId: string }) {
  const { data, isPending, isError, error, refetch, isRefetching } = useEventDetails(source, eventId);

  if (isPending) {
    return (
      <div role="status" aria-label="Loading details" className="mt-1.5 grid gap-1.5 rounded-md border bg-muted/30 p-3">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mt-1.5">
        <InlineError compact title="Couldn't load the details" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
      </div>
    );
  }
  return <DetailsBody details={data} />;
}

function DetailsBody({ details }: { details: Details }) {
  switch (details.kind) {
    case 'reading':
      return <Json value={details.result} label="The data as it was read" />;
    case 'changes':
      return <Changes changes={details.changes} checked={details.checked} unchecked={details.unchecked} />;
    case 'facts':
      return <Json value={details.facts} label="Details" />;
    case 'gone':
      return <p className="mt-1.5 text-xs text-muted-foreground">The data this refers to was deleted with the upload.</p>;
  }
}

function Json({ value, label }: { value: unknown; label: string }) {
  return (
    <pre
      aria-label={label}
      className="mt-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** What changed, field by field, as a diff: removed lines red, added green, the rest for context. */
function Changes({ changes, checked, unchecked }: { changes: FieldChange[]; checked: LabelField[]; unchecked: LabelField[] }) {
  const fieldNames = (fields: LabelField[]) => formatList(fields.map((field) => FIELD_LABELS[field].toLowerCase()), 'and');
  return (
    <div aria-label="What changed" role="group" className="mt-1.5 grid gap-2.5 rounded-md border bg-card p-3 text-xs">
      {changes.map((change) => (
        <FieldDiff key={change.field} change={change} />
      ))}
      {checked.length > 0 && (
        <p className="text-muted-foreground">
          Confirmed the {fieldNames(checked)} as {checked.length === 1 ? 'it was' : 'they were'}.
        </p>
      )}
      {unchecked.length > 0 && <p className="text-muted-foreground">Undid the checks on the {fieldNames(unchecked)}.</p>}
      {changes.length === 0 && checked.length === 0 && unchecked.length === 0 && <p className="text-muted-foreground">Nothing changed.</p>}
    </div>
  );
}

const LINE_STYLE: Record<DiffLine['kind'], string> = {
  removed: 'bg-danger-soft text-danger',
  added: 'bg-success-soft text-success',
  same: 'text-muted-foreground',
  unchanged: 'text-muted-foreground italic',
};
const LINE_SIGN: Record<DiffLine['kind'], string> = { removed: '−', added: '+', same: '', unchanged: '' };
/** For screen readers, which can't see the colour or the sign. */
const LINE_SAID: Record<DiffLine['kind'], string> = { removed: 'Removed: ', added: 'Added: ', same: '', unchanged: '' };

function FieldDiff({ change }: { change: FieldChange }) {
  const lines = foldUnchanged(diffLines(fieldLines(change.field, change.from), fieldLines(change.field, change.to)));
  return (
    <div className="grid gap-1">
      <p className="font-medium text-foreground">{FIELD_LABELS[change.field]}</p>
      <ul className="overflow-hidden rounded border border-border/70">
        {lines.map((line, index) => (
          <li key={index} className={cn('grid grid-cols-[1rem_minmax(0,1fr)] px-2 py-0.5 leading-relaxed', LINE_STYLE[line.kind])}>
            <span aria-hidden className="select-none">
              {LINE_SIGN[line.kind]}
            </span>
            <span className="wrap-anywhere">
              {line.kind === 'unchanged' ? (
                `${line.count} unchanged`
              ) : (
                <>
                  <span className="sr-only">{LINE_SAID[line.kind]}</span>
                  {line.text}
                </>
              )}
            </span>
          </li>
        ))}
        {lines.length === 0 && <li className="px-2 py-0.5 text-muted-foreground">None, before or after</li>}
      </ul>
    </div>
  );
}
