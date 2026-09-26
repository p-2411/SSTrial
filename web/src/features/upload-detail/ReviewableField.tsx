import { useId, type ReactNode } from 'react';
import { Check, Pencil } from 'lucide-react';
import { FIELD_LABELS, needsChecking, type FieldConfidence, type FieldReview, type LabelField } from '@label-extractor/shared';
import { confidenceDotClass, ConfidenceScore } from '@/components/Confidence';
import { RelativeTime } from '@/components/RelativeTime';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ReviewState {
  confidence: FieldConfidence | undefined;
  review: FieldReview | undefined;
}

/**
 * One field of the extracted data: a marker coloured by confidence, the label, the value (or its
 * editor), and on the right its confidence ("95%"), or, once a person has reviewed it,
 * nothing: who reviewed it shows under the value instead. Edit appears on hover and focus; a field that still needs
 * checking also offers "Mark as checked".
 *
 * As a `row` (the default) it's a term and its value, for a <dl>. As a `block` it's a section of
 * its own, headed by the label with the value at full width underneath, for long values.
 */
export function ReviewableField({
  field,
  label = FIELD_LABELS[field],
  layout = 'row',
  count,
  confidence,
  review,
  now,
  editor,
  onEdit,
  onCheck,
  children,
}: ReviewState & {
  field: LabelField;
  /** Instead of the field's usual name, when the value calls for another ("Net volume"). */
  label?: string;
  layout?: 'row' | 'block';
  /** How many items the value holds, shown beside a block's heading. */
  count?: number;
  now: number;
  /** The editor while this field is being edited; anything falsy shows the value (children) instead. */
  editor: ReactNode;
  onEdit: () => void;
  onCheck: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const state = { confidence, review };
  const name = label.toLowerCase();
  const editing = Boolean(editor);
  const marker = (
    <span aria-hidden className={cn('size-2 rounded-full', markerClass(state), layout === 'row' && 'translate-y-[-1px]')} />
  );
  const actions = !editing && (
    <>
      {confidence && !review && <ConfidenceScore score={confidence.score} />}
      <EditButton name={name} onClick={onEdit} />
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
        {/* Indented to line up with the label, past the marker. */}
        <div className="pl-[18px]">
          {editing ? (
            <div className="mt-2">{editor}</div>
          ) : (
            <>
              <ReviewNotes state={state} now={now} name={name} onCheck={onCheck} />
              {children}
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="group grid grid-cols-[auto_8rem_1fr_auto] items-baseline gap-x-2.5">
      {marker}
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="min-w-0 text-sm">
        {editing ? (
          editor
        ) : (
          <>
            {children}
            <ReviewNotes state={state} now={now} name={name} onCheck={onCheck} />
          </>
        )}
      </dd>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

/** Under a value: why its score is low, who reviewed it, or the offer to confirm it. */
function ReviewNotes({
  state: { confidence, review },
  now,
  name,
  onCheck,
}: {
  state: ReviewState;
  now: number;
  name: string;
  onCheck: () => void;
}) {
  if (review) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3 text-success" aria-hidden />
        {review.kind === 'edited' ? 'Edited' : 'Checked'} by {review.by ?? 'a former member'},{' '}
        <RelativeTime iso={review.at} now={now} />
      </p>
    );
  }
  if (!confidence) return null;
  const needsCheck = needsChecking(confidence.score);
  if (confidence.reasons.length === 0 && !needsCheck) return null;
  return (
    <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
      {confidence.reasons.length > 0 && (
        <ul className="grid gap-0.5">
          {confidence.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {needsCheck && (
        <Button
          variant="link"
          size="xs"
          className="h-auto justify-self-start p-0 text-xs"
          aria-label={`Mark ${name} as checked`}
          onClick={onCheck}
        >
          Mark as checked
        </Button>
      )}
    </div>
  );
}

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
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
