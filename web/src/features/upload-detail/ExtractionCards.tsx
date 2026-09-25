import type { ReactNode } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import type { Ingredient, LabelExtraction, NetQuantity, NetQuantityUnit } from '@label-extractor/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Everything extracted from the label in one card, laid out after SupplyScope's compliance
 * screens: a green-edged "Core information" card with verified values in green and a validated
 * footer. Anything the label didn't show is said explicitly, so "not found" is never mistaken for
 * "not loaded".
 */
export function CoreInformationCard({ result }: { result: LabelExtraction }) {
  const { productName, brand, netWeight, allergens, ingredients } = result;
  const quantityLabel = netWeight && VOLUME_UNITS.has(netWeight.unit) ? 'Net volume' : 'Net weight';

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
          <Field label="Product name">{productName ? <Value>{productName}</Value> : <Missing>Not found on label</Missing>}</Field>
          <Field label="Brand">{brand ? <Value>{brand}</Value> : <Missing>Not found on label</Missing>}</Field>
          <Field label={quantityLabel}>
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
          </Field>
          <Field label="Allergens">
            {allergens.length > 0 ? (
              <>
                <span className="sr-only">Contains {allergens.join(', ')}.</span>
                {/* Allergens are warnings, so they get SupplyScope's pastel-yellow treatment. */}
                <ul className="flex flex-wrap gap-1.5" aria-hidden>
                  {allergens.map((allergen) => (
                    <li
                      key={allergen}
                      className="rounded-full border border-warning-border bg-warning-soft px-2.5 py-0.5 text-sm font-medium text-warning capitalize"
                    >
                      {allergen}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Missing>None declared on label</Missing>
            )}
          </Field>
        </dl>

        {/* Ingredients get the full card width: they're the longest and most-checked part of a label. */}
        <section aria-labelledby="ingredients-heading" className="mt-4 border-t pt-4">
          <h3 id="ingredients-heading" className="flex items-center gap-2.5 text-sm font-medium">
            <span aria-hidden className="size-2 rounded-full bg-success" />
            Ingredients
            {ingredients.length > 0 && <span className="font-normal text-muted-foreground">({ingredients.length})</span>}
          </h3>
          {ingredients.length > 0 ? (
            <IngredientList ingredients={ingredients} />
          ) : (
            <p className="mt-2 pl-[18px] text-sm">
              <Missing>No ingredient list found on label</Missing>
            </p>
          )}
        </section>
      </CardContent>

      {/* Every stored result passed schema validation; say so, like SupplyScope's "verified" footer. */}
      <div className="flex items-center gap-2 bg-success px-6 py-3 text-sm font-medium text-white">
        <ShieldCheck className="size-4" aria-hidden />
        Validated against the label schema
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_8rem_1fr] items-baseline gap-x-2.5">
      <span aria-hidden className="size-2 translate-y-[-1px] rounded-full bg-success" />
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
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

function Value({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-success">{children}</span>;
}

function Missing({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}

const VOLUME_UNITS = new Set<NetQuantityUnit>(['ml', 'cl', 'l', 'fl oz']);

/** Litres as "L": a lowercase l is easily misread as the digit 1 ("1 l"). */
const UNIT_DISPLAY: Partial<Record<NetQuantityUnit, string>> = { l: 'L' };

/** { 500, g } → "500 g"; { 1.5, l } → "1.5 L"; long decimals are rounded to 2 places. */
export function formatQuantity({ value, unit }: NetQuantity): string {
  const amount = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${amount} ${UNIT_DISPLAY[unit] ?? unit}`;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}
