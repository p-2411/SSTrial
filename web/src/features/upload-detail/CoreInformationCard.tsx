import { useRef, useState, type ReactNode } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  isVolumeUnit,
  type LabelField,
  type Ingredient,
  type LabelExtraction,
  type ResultChanges,
  type UploadDetail,
} from '@label-extractor/shared';
import { ApiRequestError, errorMessage } from '@/api/client';
import { useEditResult } from '@/api/queries';
import { ConfidenceScore } from '@/components/Confidence';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatQuantity } from '@/lib/quantity';
import { TONE_CLASSES } from '@/lib/tone';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { AllergensEditor, IngredientsEditor, NetWeightEditor, TextEditor } from './FieldEditors';
import { EditButton, markerClass, ReviewableField, ReviewNotes, type ReviewState } from './ReviewableField';

/**
 * Everything extracted from the label in one card, laid out after SupplyScope's compliance
 * screens: a green-edged "Core information" card with verified values in green and a validated
 * footer. Anything the label didn't show is said explicitly, so "not found" is never mistaken for
 * "not loaded".
 *
 * Every field can be corrected in place, one at a time. When the extraction was scored, each
 * field's marker takes its confidence colour and its score sits on the right; a doubtful field can
 * also be confirmed as right. Once a person has edited or confirmed a field, who did it shows in
 * place of the score.
 */
export function CoreInformationCard({ upload }: { upload: UploadDetail & { result: LabelExtraction } }) {
  const { productName, brand, netWeight, allergens, ingredients } = upload.result;
  const quantityLabel = netWeight && isVolumeUnit(netWeight.unit) ? 'Net volume' : 'Net weight';
  const now = useNow();
  const review = useFieldReview(upload);

  const stateOf = (field: LabelField): ReviewState => ({
    confidence: upload.fieldConfidence?.[field],
    review: upload.fieldReviews[field],
  });
  const fieldProps = (field: LabelField) => ({
    state: stateOf(field),
    now,
    onEdit: () => review.edit(field),
    onCheck: () => review.check(field),
  });

  return (
    <Card role="region" aria-label="Core information" className="gap-0 overflow-hidden border-success/40 py-0 ring-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 py-4">
        <CardTitle className="text-base font-semibold">Core information</CardTitle>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Sparkles className="size-3.5" aria-hidden />
          Extracted by AI
        </span>
      </CardHeader>

      <CardContent className="pb-5">
        <dl className="grid gap-3.5">
          <ReviewableField
            label="Product name"
            {...fieldProps('productName')}
            editor={review.editing === 'productName' && <TextEditor field="productName" label="Product name" value={productName} {...review.editorProps} />}
          >
            {productName ? <Value>{productName}</Value> : <Missing>Not found on label</Missing>}
          </ReviewableField>
          <ReviewableField
            label="Brand"
            {...fieldProps('brand')}
            editor={review.editing === 'brand' && <TextEditor field="brand" label="Brand" value={brand} {...review.editorProps} />}
          >
            {brand ? <Value>{brand}</Value> : <Missing>Not found on label</Missing>}
          </ReviewableField>
          <ReviewableField
            label={quantityLabel}
            {...fieldProps('netWeight')}
            editor={review.editing === 'netWeight' && <NetWeightEditor value={netWeight} {...review.editorProps} />}
          >
            {netWeight ? (
              <>
                <Value>{formatQuantity(netWeight)}</Value>
                {/* Show the pack's own wording when it adds something (dual units, "Net Wt"…). */}
                {normalise(netWeight.text) !== normalise(formatQuantity(netWeight)) && (
                  <span className="block text-xs text-muted-foreground">Printed as “{netWeight.text}”</span>
                )}
              </>
            ) : (
              <Missing>Not found on label</Missing>
            )}
          </ReviewableField>
          <ReviewableField
            label="Allergens"
            {...fieldProps('allergens')}
            editor={review.editing === 'allergens' && <AllergensEditor value={allergens} {...review.editorProps} />}
          >
            {allergens.length > 0 ? <AllergenChips allergens={allergens} /> : <Missing>None declared on label</Missing>}
          </ReviewableField>
        </dl>

        {/* Ingredients get the full card width: they're the longest and most-checked part of a label. */}
        <section aria-labelledby="ingredients-heading" className="group mt-4 border-t pt-4">
          <div className="flex items-center gap-2.5">
            <h3 id="ingredients-heading" className="flex items-center gap-2.5 text-sm font-medium">
              <span aria-hidden className={cn('size-2 rounded-full', markerClass(stateOf('ingredients')))} />
              Ingredients
              {ingredients.length > 0 && <span className="font-normal text-muted-foreground">({ingredients.length})</span>}
            </h3>
            {review.editing !== 'ingredients' && (
              <div className="ml-auto flex items-center gap-1">
                {upload.fieldConfidence && !upload.fieldReviews.ingredients && (
                  <ConfidenceScore score={upload.fieldConfidence.ingredients.score} />
                )}
                <EditButton name="ingredients" onClick={() => review.edit('ingredients')} />
              </div>
            )}
          </div>
          {review.editing === 'ingredients' ? (
            <div className="mt-2 pl-[18px]">
              <IngredientsEditor value={ingredients} {...review.editorProps} />
            </div>
          ) : (
            <>
              <ReviewNotes
                state={stateOf('ingredients')}
                now={now}
                name="ingredients"
                onCheck={() => review.check('ingredients')}
                className="pl-[18px]"
              />
              {ingredients.length > 0 ? (
                <IngredientList ingredients={ingredients} />
              ) : (
                <p className="mt-2 pl-[18px] text-sm">
                  <Missing>No ingredient list found on label</Missing>
                </p>
              )}
            </>
          )}
        </section>
      </CardContent>

      {/* Every stored result passed schema validation, edits included; say so, like SupplyScope's "verified" footer. */}
      <div className="flex items-center gap-2 bg-success px-6 py-3 text-sm font-medium text-white">
        <ShieldCheck className="size-4" aria-hidden />
        Validated against the label schema
      </div>
    </Card>
  );
}

/**
 * Editing one field at a time, and confirming fields as right.
 *
 * Nobody's change is silently lost: when an editor opens it remembers the field's value, and a
 * save goes ahead only if that value is still what the server has. A live update showing that
 * someone else changed the same field closes the editor instead (their version shows); a change
 * to a different field doesn't matter, and the save simply goes against the latest revision. If a
 * save still loses a race, the server refuses it (409) and the same happens.
 */
function useFieldReview(upload: UploadDetail & { result: LabelExtraction }) {
  const mutation = useEditResult(upload.id);
  const [editing, setEditing] = useState<{ field: LabelField; valueAtOpen: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checking = useRef(false); // a double click mustn't send two checks

  const current = (field: LabelField) => JSON.stringify(upload.result[field]);
  const close = (field: LabelField) => setEditing((open) => (open?.field === field ? null : open));
  const theyChangedIt = (field: LabelField) => {
    close(field);
    toast.error('Someone else just changed this', { description: 'Showing their version. Make your change again if it still applies.' });
  };

  const save = async (field: LabelField, changes: ResultChanges) => {
    if (editing?.field === field && current(field) !== editing.valueAtOpen) return theyChangedIt(field);
    setError(null);
    try {
      await mutation.mutateAsync({ revision: upload.revision, changes });
      close(field);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.code === 'EDIT_CONFLICT') theyChangedIt(field);
      else setError(errorMessage(failure)); // shown in the editor, which stays open
    }
  };

  const check = async (field: LabelField) => {
    if (checking.current) return;
    checking.current = true;
    try {
      await mutation.mutateAsync({ revision: upload.revision, checked: [field] });
    } catch (failure) {
      const conflict = failure instanceof ApiRequestError && failure.code === 'EDIT_CONFLICT';
      toast.error(conflict ? 'Someone else just changed this upload' : "Couldn't mark it as checked", {
        description: conflict ? 'Showing their version. Check it again if it still applies.' : errorMessage(failure),
      });
    } finally {
      checking.current = false;
    }
  };

  return {
    editing: editing?.field ?? null,
    edit: (field: LabelField) => {
      setError(null);
      setEditing({ field, valueAtOpen: current(field) });
    },
    check: (field: LabelField) => void check(field),
    editorProps: {
      onSave: (changes: ResultChanges) => {
        if (editing) void save(editing.field, changes);
      },
      onCancel: () => setEditing(null),
      saving: mutation.isPending,
      error,
    },
  };
}

/**
 * Numbered in label order (heaviest first), with the printed percentage in its own column,
 * sub-ingredients under their parent, and allergen-bearing ingredients tinted yellow.
 */
function IngredientList({ ingredients }: { ingredients: Ingredient[] }) {
  const anyAllergens = ingredients.some((ingredient) => ingredient.allergens.length > 0);
  return (
    <>
      <ol className="mt-2 grid gap-1 pl-[18px]">
        {ingredients.map((ingredient, index) => (
          <li key={ingredient.name} className="grid grid-cols-[1.75rem_minmax(0,1fr)_3.5rem] items-baseline text-sm">
            <span aria-hidden className="text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <div className="min-w-0">
              <span
                className={cn(ingredient.allergens.length > 0 && '-mx-1.5 rounded bg-warning-soft px-1.5 py-0.5 text-warning')}
                title={ingredient.allergens.length > 0 ? `Contains ${ingredient.allergens.join(', ')}` : undefined}
              >
                {ingredient.name}
              </span>
              {ingredient.allergens.length > 0 && (
                <span className="sr-only"> (contains {ingredient.allergens.join(', ')})</span>
              )}
              {ingredient.subIngredients.length > 0 && (
                <span className="block pl-3.5 text-xs text-muted-foreground">{ingredient.subIngredients.join(', ')}</span>
              )}
            </div>
            <span className="text-right tabular-nums">{ingredient.percent !== null && `${ingredient.percent}%`}</span>
          </li>
        ))}
      </ol>
      {anyAllergens && (
        <p className="mt-3 pl-[18px] text-xs text-muted-foreground">Highlighted ingredients contain a declared allergen.</p>
      )}
    </>
  );
}

/** Allergens are warnings, so they get SupplyScope's pastel-yellow treatment. Read out as one sentence. */
function AllergenChips({ allergens }: { allergens: string[] }) {
  return (
    <>
      <span className="sr-only">Contains {allergens.join(', ')}.</span>
      <ul className="flex flex-wrap gap-1.5" aria-hidden>
        {allergens.map((allergen) => (
          <li key={allergen} className={cn('rounded-full border px-2.5 py-0.5 text-sm font-medium capitalize', TONE_CLASSES.warning)}>
            {allergen}
          </li>
        ))}
      </ul>
    </>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-success">{children}</span>;
}

function Missing({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}
