import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import { Pencil } from 'lucide-react';
import { FIELD_LABELS, type FieldConfidence, type FieldReview, type LabelField } from '@label-extractor/shared';
import { confidenceDotClass, ConfidenceScore } from '@/components/Confidence';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ReviewState {
  confidence: FieldConfidence | undefined;
  review: FieldReview | undefined;
}

/**
 * One field of the extracted data: a marker coloured by confidence, the label, the value (or its
 * editor), and on the right its confidence ("95%"), or, once a person has reviewed it, "Checked" or
 * "Edited" (who, in its tooltip; the latest, and when, in the detail's header). A reviewed field
 * counts as 100% towards the upload's confidence. Edit appears on hover and focus. Under a
 * doubtful value, the reasons for the doubt; confirming it is the card footer's "Mark as checked".
 *
 * As a `row` (the default) it's a term and its value, for a <dl>. As a `block` it's a section of
 * its own, headed by the label with the value at full width underneath, for long values.
 *
 * Save or Cancel closes the editor, and focus goes back to Edit, where it started.
 */
export function ReviewableField({
  field,
  label = FIELD_LABELS[field],
  layout = 'row',
  count,
  confidence,
  review,
  editor,
  onEdit,
  children,
}: ReviewState & {
  field: LabelField;
  /** Instead of the field's usual name, when the value calls for another ("Net volume"). */
  label?: string;
  layout?: 'row' | 'block';
  /** How many items the value holds, shown beside a block's heading. */
  count?: number;
  /** The editor while this field is being edited; anything falsy shows the value (children) instead. */
  editor: ReactNode;
  /** Opens the editor. Without it, there's no Edit button (nothing may be changed). */
  onEdit?: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const state = { confidence, review };
  const name = label.toLowerCase();
  const editing = Boolean(editor);
  const editButton = useRefocusAfterEditing(editing);
  const marker = (
    <span aria-hidden className={cn('size-2 rounded-full', markerClass(state), layout === 'row' && 'translate-y-[-1px]')} />
  );
  const actions = !editing && (
    <>
      {review ? <ReviewedMark review={review} /> : confidence && <ConfidenceScore score={confidence.score} />}
      {onEdit && <EditButton ref={editButton} name={name} onClick={onEdit} />}
    </>
  );

  if (layout === 'block') {
    return (
      <section aria-labelledby={headingId} className="group">
        <div className="flex items-center gap-2.5">
          <h3 id={headingId} className="flex items-center gap-2.5 text-sm font-medium">
            {marker}
            {label}
            {count !== undefined && count > 0 && <span className="font-normal text-muted-foreground">({count})</span>}
          </h3>
          {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
        </div>
        {/* Indented to line up with the label, past the marker. wrap-anywhere: a long unbroken word
            wraps rather than spilling past the card. */}
        <div className="pl-[18px] wrap-anywhere">
          {editing ? (
            <div className="mt-2">{editor}</div>
          ) : (
            <>
              <ReviewNotes state={state} />
              {children}
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="group grid grid-cols-[auto_8rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5">
      {marker}
      <dt className="text-sm font-medium">{label}</dt>
      {/* wrap-anywhere: a long unbroken value wraps within its column rather than running under
          the score beside it. */}
      <dd className="min-w-0 text-sm wrap-anywhere">
        {editing ? (
          editor
        ) : (
          <>
            {children}
            <ReviewNotes state={state} />
          </>
        )}
      </dd>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

/** In place of a reviewed field's score: that a person settled it, and who (in the tooltip). */
function ReviewedMark({ review }: { review: FieldReview }) {
  const kind = review.kind === 'edited' ? 'Edited' : 'Checked';
  return (
    <span className="shrink-0 text-xs text-muted-foreground" title={`${kind} by ${review.by ?? 'a former member'}`}>
      {kind}
    </span>
  );
}

/** Under a value that nobody has reviewed yet: why its score is lower, if the model or a check said. */
function ReviewNotes({ state: { confidence, review } }: { state: ReviewState }) {
  if (review || !confidence || confidence.reasons.length === 0) return null;
  return (
    <ul className="mt-1 grid grid-cols-1 gap-0.5 text-xs text-muted-foreground">
      {confidence.reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}

/**
 * The Edit button's ref. When the editor closes (Save, Cancel), the button it replaced comes back,
 * and focus, lost with the editor's own buttons, goes to it.
 */
function useRefocusAfterEditing(editing: boolean) {
  const button = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  useEffect(() => {
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !active.isConnected;
    if (wasEditing.current && !editing && focusLost) button.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  return button;
}

function EditButton({ ref, name, onClick }: { ref: Ref<HTMLButtonElement>; name: string; onClick: () => void }) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon-xs"
      aria-label={`Edit ${name}`}
      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      onClick={onClick}
    >
      <Pencil aria-hidden />
    </Button>
  );
}

/** Reviewed fields are settled: green. Otherwise the confidence band's colour. */
function markerClass({ confidence, review }: ReviewState): string {
  return confidenceDotClass(review ? null : (confidence?.score ?? null));
}
