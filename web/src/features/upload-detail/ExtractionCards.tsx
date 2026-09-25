import type { ReactNode } from 'react';
import { ShieldCheck, Sparkles, TriangleAlert, Wheat } from 'lucide-react';
import type { LabelExtraction, NetQuantity, NetQuantityUnit } from '@label-extractor/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The extracted data, laid out after SupplyScope's compliance screens: a green-edged "Core
 * information" card (verified data in green), a pastel card for allergens (a warning, so yellow),
 * and the ingredient list. Anything the label didn't show is said explicitly, so "not found" is
 * never mistaken for "not loaded".
 */

export function CoreInformationCard({ result }: { result: LabelExtraction }) {
  const { productName, brand, netWeight } = result;
  const quantityLabel = netWeight && VOLUME_UNITS.has(netWeight.unit) ? 'Net volume' : 'Net weight';

  return (
    <Card role="region" className="gap-0 overflow-hidden border-success/40 py-0 ring-0" aria-label="Core information">
      <CardHeader className="flex flex-row items-center justify-between gap-3 py-4">
        <CardTitle className="text-base font-semibold">Core information</CardTitle>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Sparkles className="size-3.5" aria-hidden />
          Extracted by AI
        </span>
      </CardHeader>
      <CardContent className="pb-4">
        <dl className="grid gap-3">
          <Field label="Product name" value={productName} missing="Not found on label" />
          <Field label="Brand" value={brand} missing="Not found on label" />
          <Field
            label={quantityLabel}
            value={netWeight && formatQuantity(netWeight)}
            missing="Not found on label"
            // Show the pack's own wording when it adds something (dual units, "Net Wt"…).
            note={
              netWeight && normalise(netWeight.text) !== normalise(formatQuantity(netWeight))
                ? `Printed as “${netWeight.text}”`
                : undefined
            }
          />
        </dl>
      </CardContent>
      {/* Every stored result passed schema validation; say so, like SupplyScope's "verified" footer. */}
      <div className="flex items-center gap-2 bg-success px-6 py-3 text-sm font-medium text-white">
        <ShieldCheck className="size-4" aria-hidden />
        Validated against the label schema
      </div>
    </Card>
  );
}

function Field({ label, value, missing, note }: { label: string; value: string | null; missing: string; note?: string }) {
  return (
    <div className="grid grid-cols-[auto_8rem_1fr] items-baseline gap-x-2.5">
      <span aria-hidden className="size-2 translate-y-[-1px] rounded-full bg-success" />
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-sm">
        {value ? (
          <>
            <span className="font-semibold text-success">{value}</span>
            {note && <span className="block text-xs text-muted-foreground">{note}</span>}
          </>
        ) : (
          <Missing>{missing}</Missing>
        )}
      </dd>
    </div>
  );
}

export function AllergensCard({ allergens }: { allergens: string[] }) {
  return (
    <Card className="gap-3 border-warning-border bg-warning-soft py-4 ring-0" aria-labelledby="allergens-heading">
      <CardHeader>
        <CardTitle id="allergens-heading" className="flex items-center gap-2 text-base font-semibold">
          <TriangleAlert className="size-4 text-warning" aria-hidden />
          Allergens
        </CardTitle>
      </CardHeader>
      <CardContent>
        {allergens.length > 0 ? (
          <>
            <p className="sr-only">Contains {allergens.join(', ')}.</p>
            <ul className="flex flex-wrap gap-1.5" aria-hidden>
              {allergens.map((allergen) => (
                <li key={allergen} className="rounded-full border border-warning-border bg-card px-2.5 py-0.5 text-sm font-medium text-warning capitalize">
                  {allergen}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Missing>No allergens declared on label</Missing>
        )}
      </CardContent>
    </Card>
  );
}

export function IngredientsCard({ ingredients }: { ingredients: string[] }) {
  return (
    <Card className="gap-3 py-4" aria-labelledby="ingredients-heading">
      <CardHeader>
        <CardTitle id="ingredients-heading" className="flex items-center gap-2 text-base font-semibold">
          <Wheat className="size-4 text-muted-foreground" aria-hidden />
          Ingredients
          {ingredients.length > 0 && <span className="font-normal text-muted-foreground">({ingredients.length})</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ingredients.length > 0 ? (
          // Written as a comma-separated run, the way labels print it, but each item stays addressable.
          <ul className="text-sm leading-relaxed [&>li]:inline [&>li:last-child]:after:content-['.'] [&>li:not(:last-child)]:after:content-[',_']">
            {ingredients.map((ingredient, index) => (
              <li key={`${index}-${ingredient}`}>{ingredient}</li>
            ))}
          </ul>
        ) : (
          <Missing>No ingredient list found on label</Missing>
        )}
      </CardContent>
    </Card>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground italic">{children}</span>;
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
