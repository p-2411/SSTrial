import type { ReactNode } from 'react';
import {
  flaggedFields,
  isVolumeUnit,
  type Ingredient,
  type LabelExtraction,
  type LabelField,
  type UploadDetail,
} from '@label-extractor/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatQuantity } from '@/lib/quantity';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { ConfidenceFooter, confidenceBorderClass } from './ConfidenceFooter';
import { AllergensEditor, IngredientsEditor, NetWeightEditor, TextEditor } from './FieldEditors';
import { ReviewableField } from './ReviewableField';
import { useFieldReview } from './useFieldReview';

/**
 * Everything extracted from the label in one card, laid out after SupplyScope's compliance
 * screens: verified values in green, and a footer giving the verdict, the upload's overall
 * confidence: green when it can be trusted as it is, amber or red (with the card's edge to match)
 * when some field is worth checking. Anything the label didn't show is said explicitly, so "not
 * found" is never mistaken for "not loaded".
 *
 * Every field can be corrected in place, one at a time (see useFieldReview). When the extraction
 * was scored, each field's marker takes its confidence colour and its score sits on the right, in
 * a column headed "Confidence". The footer's "Mark as checked" confirms every flagged field as
 * right at once. A checked or corrected field says "Checked" or "Edited" in place of its score,
 * and counts as 100% towards the upload's confidence; who did it, and when, is in the detail's
 * header.
 */
export function ProductInformationCard({ upload }: { upload: UploadDetail & { result: LabelExtraction } }) {
  const { productName, brand, netWeight, allergens, ingredients } = upload.result;
  const fields = useFieldReview(upload);

  const fieldProps = (field: LabelField) => ({
    field,
    confidence: upload.fieldConfidence?.[field],
    review: upload.fieldReviews[field],
    onEdit: () => fields.edit(field),
  });

  return (
    <Card role="region" aria-label="Product information" className={cn('gap-0 overflow-hidden border py-0 ring-0', confidenceBorderClass(upload))}>
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

      <ConfidenceFooter
        upload={upload}
        onCheck={() => fields.check(flaggedFields(upload.fieldConfidence, Object.keys(upload.fieldReviews) as LabelField[]))}
        checking={fields.checking}
      />
    </Card>
  );
}

/** Position, title and printed percentage, for the list and its headings. */
const INGREDIENT_COLUMNS = 'grid grid-cols-[1.75rem_minmax(0,1fr)_3.5rem]';

/**
 * Numbered in label order (heaviest first), with the printed percentage in its own column,
 * sub-ingredients under their parent, and allergen-bearing ingredients tinted yellow.
 */
function IngredientList({ ingredients }: { ingredients: Ingredient[] }) {
  const anyAllergens = ingredients.some((ingredient) => ingredient.allergens.length > 0);
  return (
    <>
      {/* Column headings, as in the editor. For sight only: each row reads fine on its own. */}
      <div aria-hidden className={cn(INGREDIENT_COLUMNS, 'mt-2 text-xs font-medium text-muted-foreground')}>
        <span />
        <span>Title</span>
        <span className="text-right">%</span>
      </div>
      <ol className="mt-1 grid gap-1">
        {ingredients.map((ingredient, index) => (
          <li key={ingredient.name} className={cn(INGREDIENT_COLUMNS, 'items-baseline text-sm')}>
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
