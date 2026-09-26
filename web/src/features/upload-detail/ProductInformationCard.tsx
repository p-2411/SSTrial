import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { isVolumeUnit, type Ingredient, type LabelExtraction, type LabelField, type UploadDetail } from '@label-extractor/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatQuantity } from '@/lib/quantity';
import { TONE_CLASSES } from '@/lib/tone';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { AllergensEditor, IngredientsEditor, NetWeightEditor, TextEditor } from './FieldEditors';
import { ReviewableField } from './ReviewableField';
import { useFieldReview } from './useFieldReview';

/**
 * Everything extracted from the label in one card, laid out after SupplyScope's compliance
 * screens: a green-edged card with verified values in green and a validated footer. Anything the label didn't show is said explicitly, so "not found" is never mistaken for
 * "not loaded".
 *
 * Every field can be corrected in place, one at a time (see useFieldReview). When the extraction
 * was scored, each field's marker takes its confidence colour and its score sits on the right, in a
 * column headed "Confidence"; a doubtful field can also be confirmed as right. Once a person has edited or confirmed a field,
 * who did it shows in place of the score.
 */
export function ProductInformationCard({ upload }: { upload: UploadDetail & { result: LabelExtraction } }) {
  const { productName, brand, netWeight, allergens, ingredients } = upload.result;
  const now = useNow();
  const fields = useFieldReview(upload);

  const fieldProps = (field: LabelField) => ({
    field,
    confidence: upload.fieldConfidence?.[field],
    review: upload.fieldReviews[field],
    now,
    onEdit: () => fields.edit(field),
    onCheck: () => fields.check(field),
  });

  return (
    <Card role="region" aria-label="Product information" className="gap-0 overflow-hidden border-success/40 py-0 ring-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 py-4">
        <CardTitle className="text-base font-semibold">Product information</CardTitle>
        {/* Heads the scores on the right. pr-7 lines it up with them: each row's edit button sits
            past its score (a 24px button after a 4px gap). */}
        {upload.fieldConfidence && <span className="pr-7 text-xs font-medium text-muted-foreground">Confidence</span>}
      </CardHeader>

      <CardContent className="pb-5">
        <dl className="grid gap-3.5">
          <ReviewableField
            {...fieldProps('productName')}
            editor={fields.editing === 'productName' && <TextEditor field="productName" value={productName} {...fields.editorProps} />}
          >
            {productName ? <Value>{productName}</Value> : <Missing>Not found on label</Missing>}
          </ReviewableField>
          <ReviewableField
            {...fieldProps('brand')}
            editor={fields.editing === 'brand' && <TextEditor field="brand" value={brand} {...fields.editorProps} />}
          >
            {brand ? <Value>{brand}</Value> : <Missing>Not found on label</Missing>}
          </ReviewableField>
          <ReviewableField
            {...fieldProps('netWeight')}
            label={netWeight && isVolumeUnit(netWeight.unit) ? 'Net volume' : undefined}
            editor={fields.editing === 'netWeight' && <NetWeightEditor value={netWeight} {...fields.editorProps} />}
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
            {...fieldProps('allergens')}
            editor={fields.editing === 'allergens' && <AllergensEditor value={allergens} {...fields.editorProps} />}
          >
            {allergens.length > 0 ? <AllergenChips allergens={allergens} /> : <Missing>None declared on label</Missing>}
          </ReviewableField>
        </dl>

        {/* Ingredients get the full card width: they're the longest and most-checked part of a label. */}
        <div className="mt-4 border-t pt-4">
          <ReviewableField
            {...fieldProps('ingredients')}
            layout="block"
            count={ingredients.length}
            editor={fields.editing === 'ingredients' && <IngredientsEditor value={ingredients} {...fields.editorProps} />}
          >
            {ingredients.length > 0 ? (
              <IngredientList ingredients={ingredients} />
            ) : (
              <p className="mt-2 text-sm">
                <Missing>No ingredient list found on label</Missing>
              </p>
            )}
          </ReviewableField>
        </div>
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
 * Numbered in label order (heaviest first), with the printed percentage in its own column,
 * sub-ingredients under their parent, and allergen-bearing ingredients tinted yellow.
 */
function IngredientList({ ingredients }: { ingredients: Ingredient[] }) {
  const anyAllergens = ingredients.some((ingredient) => ingredient.allergens.length > 0);
  return (
    <>
      <ol className="mt-2 grid gap-1">
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
      {anyAllergens && <p className="mt-3 text-xs text-muted-foreground">Highlighted ingredients contain a declared allergen.</p>}
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
