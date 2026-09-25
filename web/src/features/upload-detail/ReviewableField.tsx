import type { ReactNode } from 'react';
import { Check, Pencil } from 'lucide-react';
import { CONFIDENT_SCORE, type FieldConfidence, type FieldReview } from '@label-extractor/shared';
import { confidenceDotClass, ConfidenceScore } from '@/components/Confidence';
import { RelativeTime } from '@/components/RelativeTime';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ReviewState {
  confidence: FieldConfidence | undefined;
  review: FieldReview | undefined;
}

/**
 * One field of the extracted data, as a row: a marker coloured by confidence, the label, the value
 * (or its editor), and on the right its score, or, once a person has reviewed it, nothing: who
 * reviewed it shows under the value instead. Edit appears on hover and focus; a field that still
 * needs checking also offers "Mark as checked".
 */
export function ReviewableField({
  label,
  state,
  now,
  editor,
  onEdit,
  onCheck,
  children,
}: {
  label: string;
  state: ReviewState;
  now: number;
  /** The editor while this field is being edited; anything falsy shows the value (children) instead. */
  editor: ReactNode;
  onEdit: () => void;
  onCheck: () => void;
  children: ReactNode;
}) {
  const { confidence, review } = state;
  const name = label.toLowerCase();
  const editing = Boolean(editor);
  return (
    <div className="group grid grid-cols-[auto_8rem_1fr_auto] items-baseline gap-x-2.5">
      <span aria-hidden className={cn('size-2 translate-y-[-1px] rounded-full', markerClass(state))} />
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
      <div className="flex items-center gap-1">
        {confidence && !review && !editing && <ConfidenceScore score={confidence.score} />}
        {!editing && <EditButton name={name} onClick={onEdit} />}
      </div>
    </div>
  );
}

/** Under a value: why its score is low, who reviewed it, or the offer to confirm it. */
export function ReviewNotes({
  state: { confidence, review },
  now,
  name,
  onCheck,
  className,
}: {
  state: ReviewState;
  now: number;
  name: string;
  onCheck: () => void;
  className?: string;
}) {
  if (review) {
    return (
      <p className={cn('mt-1 flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <Check className="size-3 text-success" aria-hidden />
        {review.kind === 'edited' ? 'Edited' : 'Checked'} by {review.by ?? 'a former member'},{' '}
        <RelativeTime iso={review.at} now={now} />
      </p>
    );
  }
  if (!confidence) return null;
  const needsCheck = confidence.score < CONFIDENT_SCORE;
  if (confidence.reasons.length === 0 && !needsCheck) return null;
  return (
    <div className={cn('mt-1 grid gap-0.5 text-xs text-muted-foreground', className)}>
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

export function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
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
export function markerClass({ confidence, review }: ReviewState): string {
  return confidenceDotClass(review ? null : (confidence?.score ?? null));
}
