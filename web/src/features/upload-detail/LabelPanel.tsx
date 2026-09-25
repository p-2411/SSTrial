import type { ReactNode } from 'react';
import type { LabelExtraction, NetQuantity, NetQuantityUnit } from '@label-extractor/shared';
import styles from './LabelPanel.module.css';

/**
 * The extracted data, laid out like the information panel printed on packaging: heavy rules
 * separating sections, the product name set big and condensed. Anything the label didn't show is
 * stated explicitly rather than left blank, so "not found" is never mistaken for "not loaded".
 */
export function LabelPanel({ result }: { result: LabelExtraction }) {
  const { productName, brand, netWeight, allergens, ingredients } = result;

  return (
    <article className={styles.panel} aria-label="Extracted product information">
      <p className={styles.brand}>{brand ?? <Missing>Brand not found on label</Missing>}</p>
      <h2 className={styles.name}>{productName ?? <Missing>Product name not found</Missing>}</h2>

      <hr className={styles.thick} />

      <section className={styles.row} aria-labelledby="net-quantity">
        <h3 id="net-quantity" className={styles.term}>
          {netWeight && VOLUME_UNITS.has(netWeight.unit) ? 'Net volume' : 'Net weight'}
        </h3>
        {netWeight ? <p className={styles.quantity}>{formatQuantity(netWeight)}</p> : <Missing>Not found on label</Missing>}
      </section>
      {/* Show the wording from the pack when it adds something (dual units, "Net Wt" etc.). */}
      {netWeight && normalise(netWeight.text) !== normalise(formatQuantity(netWeight)) && (
        <p className={styles.asPrinted}>Printed as “{netWeight.text}”</p>
      )}

      <hr className={styles.medium} />

      <section aria-labelledby="allergens">
        <h3 id="allergens" className={styles.term}>
          Allergens
        </h3>
        {allergens.length > 0 ? (
          <p className={styles.contains}>Contains {allergens.join(', ')}.</p>
        ) : (
          <Missing>No allergens declared on label</Missing>
        )}
      </section>

      <hr className={styles.thin} />

      <section aria-labelledby="ingredients">
        <h3 id="ingredients" className={styles.term}>
          Ingredients{ingredients.length > 0 && <span className={styles.count}> ({ingredients.length})</span>}
        </h3>
        {ingredients.length > 0 ? (
          // Written as a comma-separated run, the way labels print it, but each item stays addressable.
          <ul className={styles.ingredients}>
            {ingredients.map((ingredient, index) => (
              <li key={`${index}-${ingredient}`}>{ingredient}</li>
            ))}
          </ul>
        ) : (
          <Missing>No ingredient list found on label</Missing>
        )}
      </section>
    </article>
  );
}

function Missing({ children }: { children: string }) {
  return <span className={styles.missing}>{children}</span>;
}

const VOLUME_UNITS = new Set<NetQuantityUnit>(['ml', 'cl', 'l', 'fl oz']);

/** Litres as "L": a lowercase l is easily misread as the digit 1 ("1 l"). */
const UNIT_DISPLAY: Partial<Record<NetQuantityUnit, string>> = { l: 'L' };

/** { 500, g } → "500 g"; { 1.5, l } → "1.5 L"; long decimals are rounded to 2 places. */
function formatQuantity({ value, unit }: NetQuantity): string {
  const amount = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${amount} ${UNIT_DISPLAY[unit] ?? unit}`;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/** The same panel with empty rules — shown before anything is selected, as a hint of what appears. */
export function LabelPanelOutline({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.panel} ${styles.outline}`}>
      <div className={styles.outlineBlock} style={{ width: '38%' }} />
      <div className={styles.outlineBlock} style={{ width: '72%', height: 28, marginTop: 8 }} />
      <hr className={styles.thick} />
      <div className={styles.outlineBlock} style={{ width: '55%' }} />
      <hr className={styles.medium} />
      <div className={styles.outlineMessage}>{children}</div>
      <hr className={styles.thin} />
      <div className={styles.outlineBlock} style={{ width: '90%' }} />
      <div className={styles.outlineBlock} style={{ width: '80%', marginTop: 8 }} />
    </div>
  );
}
