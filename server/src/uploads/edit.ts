import {
  FIELD_LABELS,
  labelExtractionSchema,
  type ConfidenceField,
  type CurrentMember,
  type EditResultRequest,
  type LabelExtraction,
  type ResultChanges,
} from '@label-extractor/shared';
import { textShowsAmount } from '../extraction/confidence-checks.ts';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import type { StoredFieldReviews, UploadQueries, UploadRecord, UploadReviews } from './store.ts';

/**
 * A person correcting or confirming a completed upload's extracted data, field by field.
 *
 * Corrections go through the same schema as model output, so edited data is held to the same
 * rules. Each save names the revision it was made against: if someone else saved first, nothing is
 * written and the caller gets the latest version instead (no silently lost edits). Every edited or
 * confirmed field records who reviewed it, which also takes it out of the upload's confidence
 * score: a person has looked at it.
 */

export type EditOutcome =
  | { outcome: 'saved'; upload: UploadRecord }
  /** A value the extraction schema rejects; `message` says which field and why. */
  | { outcome: 'invalid'; message: string }
  /** Someone else saved first: here's the upload as it is now. */
  | { outcome: 'conflict'; upload: UploadRecord }
  /** Not completed, or its saved result can't be read: there's nothing to edit. */
  | { outcome: 'not-editable' }
  | { outcome: 'not-found' };

export interface EditDeps {
  uploads: Pick<UploadQueries, 'findById'> & UploadReviews;
  events: EventLog;
  now?: () => Date;
}

export async function editResult(
  deps: EditDeps,
  id: string,
  request: EditResultRequest,
  editor: Pick<CurrentMember, 'id' | 'email'>,
): Promise<EditOutcome> {
  const upload = await deps.uploads.findById(id);
  if (!upload) return { outcome: 'not-found' };
  if (upload.status !== 'completed' || !upload.result) return { outcome: 'not-editable' };
  if (upload.resultRevision !== request.revision) return { outcome: 'conflict', upload };
  const current = upload.result;

  const changes = request.changes ?? {};
  const parsed = labelExtractionSchema.safeParse(applyChanges(current, changes));
  if (!parsed.success) return { outcome: 'invalid', message: describeProblem(parsed.error.issues[0]) };
  const result = parsed.data;

  // Only fields a person changed count as edited: not a change that leaves a field as it was, and
  // not a field that changed as a consequence (an ingredient losing an allergen removed from the list).
  const edited = (Object.keys(changes) as ConfidenceField[]).filter((field) => !sameValue(result[field], current[field]));
  const checked = (request.checked ?? []).filter((field) => !edited.includes(field));
  if (edited.length === 0 && checked.length === 0) return { outcome: 'saved', upload };

  const at = deps.now?.() ?? new Date();
  const fieldReviews: StoredFieldReviews = { ...upload.fieldReviews };
  for (const field of edited) fieldReviews[field] = { kind: 'edited', by: editor.id, at };
  for (const field of checked) fieldReviews[field] = { kind: 'checked', by: editor.id, at };

  const saved = await deps.uploads.saveReview(id, request.revision, edited.length > 0 ? result : current, fieldReviews);
  if (!saved) {
    // Someone saved between our read and our write.
    const latest = await deps.uploads.findById(id);
    return latest ? { outcome: 'conflict', upload: latest } : { outcome: 'not-found' };
  }
  await deps.events.record(
    logEvents.resultEdited(saved, {
      by: editor.email,
      changes: Object.fromEntries(edited.map((field) => [field, { from: current[field], to: result[field] }])),
      checked,
    }),
  );
  return { outcome: 'saved', upload: saved };
}

/** The current result with the changes applied, ready to validate. */
function applyChanges(current: LabelExtraction, changes: ResultChanges): unknown {
  const next: Record<string, unknown> = { ...current };
  for (const field of ['productName', 'brand', 'allergens', 'ingredients'] as const) {
    if (field in changes) next[field] = changes[field];
  }
  if ('netWeight' in changes) {
    const amount = changes.netWeight;
    // The pack's wording stays if it states the corrected amount ("16 oz (454 g)" corrected to 454 g).
    // If it doesn't, it was most likely misread along with the amount, so the correction replaces it
    // rather than leave data that contradicts itself.
    const printed = current.netWeight?.text;
    next.netWeight = amount
      ? { ...amount, text: printed && textShowsAmount(printed, amount.value) ? printed : `${amount.value} ${amount.unit}` }
      : null;
  }
  return next;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A schema problem, for the person who made it: which field, and what's wrong. */
function describeProblem(issue: { path: PropertyKey[]; message: string } | undefined): string {
  const field = issue?.path[0];
  const label = typeof field === 'string' && field in FIELD_LABELS ? FIELD_LABELS[field as ConfidenceField] : 'A value';
  return `${label} isn't valid: ${issue?.message ?? 'check it and try again'}.`;
}
