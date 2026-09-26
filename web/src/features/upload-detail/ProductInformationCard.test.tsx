import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { overallConfidence, type ExtractionConfidence, type FieldReviews, type LabelExtraction } from '@label-extractor/shared';
import { detail } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ProductInformationCard } from './ProductInformationCard';

const full: LabelExtraction = {
  productName: 'Maple Pecan Crunch',
  brand: 'Harvest & Hearth',
  ingredients: [
    { name: 'Rolled oats', percent: 48, subIngredients: [], allergens: ['oats', 'gluten'] },
    { name: 'Maple syrup', percent: 12, subIngredients: [], allergens: [] },
    { name: 'Puffed rice', percent: null, subIngredients: ['rice', 'salt'], allergens: [] },
  ],
  allergens: ['oats', 'gluten'],
  netWeight: { value: 1, unit: 'l', text: '1 L' },
};

const empty: LabelExtraction = { productName: null, brand: null, ingredients: [], allergens: [], netWeight: null };

/** The card as the API would send it: the overall score is worked out from the fields', as on the server. */
function renderCard(result: LabelExtraction, confidence: ExtractionConfidence | null = null, fieldReviews: FieldReviews = {}) {
  const upload = detail({
    fieldConfidence: confidence,
    confidence: overallConfidence(confidence, Object.keys(fieldReviews) as (keyof FieldReviews)[]),
    fieldReviews,
  });
  renderWithProviders(<ProductInformationCard upload={{ ...upload, result }} />);
  return screen.getByRole('region', { name: 'Product information' });
}

describe('ProductInformationCard', () => {
  it('shows every extracted field in one card, and that the data was validated', () => {
    const card = renderCard(full);

    expect(within(card).getByText('Maple Pecan Crunch')).toBeInTheDocument();
    expect(within(card).getByText('Harvest & Hearth')).toBeInTheDocument();
    expect(within(card).getByText('Contains oats, gluten.')).toBeInTheDocument();
    expect(within(card).getByText('Validated against the label schema')).toBeInTheDocument();
  });

  it('lists ingredients in label order with percentages and sub-ingredients', () => {
    const card = renderCard(full);
    const items = within(within(card).getByRole('region', { name: /Ingredients/ })).getAllByRole('listitem');

    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Rolled oats');
    expect(items[0]).toHaveTextContent('48%');
    expect(items[2]).toHaveTextContent('Puffed rice');
    expect(items[2]).toHaveTextContent('rice, salt');
  });

  it('marks ingredients that contain a declared allergen', () => {
    renderCard(full);

    expect(screen.getByText('(contains oats, gluten)')).toBeInTheDocument();
    expect(screen.getByText('Highlighted ingredients contain a declared allergen.')).toBeInTheDocument();
  });

  it('labels liquids as volume, writes litres as L, and skips a redundant "printed as"', () => {
    renderCard(full);

    expect(screen.getByText('Net volume')).toBeInTheDocument();
    expect(screen.getByText('1 L')).toBeInTheDocument();
    expect(screen.queryByText(/Printed as/)).not.toBeInTheDocument();
  });

  it('keeps the printed wording when it adds information', () => {
    renderCard({ ...full, netWeight: { value: 500, unit: 'g', text: 'Net Wt 500 g (17.6 oz)' } });

    expect(screen.getByText('Net weight')).toBeInTheDocument();
    expect(screen.getByText('Printed as “Net Wt 500 g (17.6 oz)”')).toBeInTheDocument();
  });

  it('says explicitly when something was not on the label', () => {
    renderCard(empty);

    expect(screen.getAllByText('Not found on label')).toHaveLength(3);
    expect(screen.getByText('None declared on label')).toBeInTheDocument();
    expect(screen.getByText('No ingredient list found on label')).toBeInTheDocument();
    expect(screen.queryByText(/Highlighted ingredients/)).not.toBeInTheDocument();
  });

  describe('confidence', () => {
    const confidence: ExtractionConfidence = {
      productName: { score: 97, reasons: [] },
      brand: { score: 95, reasons: [] },
      netWeight: { score: 72, reasons: ['Partly hidden by a fold.'] },
      allergens: { score: 45, reasons: ['No ingredient contains milk.'] },
      ingredients: { score: 90, reasons: [] },
    };

    it('scores every field, and says why for any that need checking', () => {
      const card = renderCard(full, confidence);

      // Just the percentage, under one Confidence heading for all of them.
      expect(within(card).getByText('Confidence', { ignore: '.sr-only' })).toBeInTheDocument();
      expect(within(card).getByText('97%')).toHaveClass('text-muted-foreground');
      expect(within(card).getByText('72%')).toHaveTextContent('Confidence 72%, worth checking'); // as read aloud
      expect(within(card).getByText('72%')).toHaveClass('text-warning');
      expect(within(card).getByText('45%')).toHaveClass('text-danger');
      expect(within(card).getByText('Partly hidden by a fold.')).toBeInTheDocument();
      expect(within(card).getByText('No ingredient contains milk.')).toBeInTheDocument();
    });

    it('shows no scores for an extraction that was never scored', () => {
      const card = renderCard(full, null);
      expect(within(card).queryByText(/Confidence/)).not.toBeInTheDocument(); // no heading either
    });
  });

  describe('footer: the overall confidence', () => {
    const scored = (scores: number[]): ExtractionConfidence => {
      const [productName, brand, netWeight, allergens, ingredients] = scores.map((score) => ({ score, reasons: [] }));
      return { productName: productName!, brand: brand!, netWeight: netWeight!, allergens: allergens!, ingredients: ingredients! };
    };
    const footer = (card: HTMLElement) => within(card).getByRole('status');

    it('is green when every field is confidently read', () => {
      const card = renderCard(full, scored([97, 95, 92, 90, 88]));
      expect(footer(card)).toHaveTextContent('High confidence (88%)');
      expect(footer(card).parentElement).toHaveClass('bg-success'); // the bar around the verdict
    });

    it('is amber, and asks for a check, when a field is worth checking', () => {
      const card = renderCard(full, scored([97, 72, 92, 90, 88]));
      expect(footer(card)).toHaveTextContent('Medium confidence (72%). Check flagged fields.');
      expect(card).toHaveClass('border-warning-border');
    });

    it('is red when a field is more likely wrong than right', () => {
      const card = renderCard(full, scored([97, 72, 45, 90, 88]));
      expect(footer(card)).toHaveTextContent('Low confidence (45%). Check flagged fields.');
      expect(card).toHaveClass('border-danger-border');
    });

    it('is green again once people have reviewed the doubtful fields', () => {
      const at = new Date().toISOString();
      const card = renderCard(full, scored([97, 72, 45, 90, 88]), {
        brand: { kind: 'checked', by: 'alice@example.com', at },
        netWeight: { kind: 'edited', by: 'alice@example.com', at },
      });
      expect(footer(card)).toHaveTextContent('High confidence (88%)');
    });

    it('is 100% once a person has reviewed every field', () => {
      const at = new Date().toISOString();
      const review = { kind: 'checked' as const, by: 'alice@example.com', at };
      const card = renderCard(full, scored([97, 72, 45, 90, 88]), {
        productName: review, brand: review, netWeight: review, allergens: review, ingredients: review,
      });
      expect(footer(card)).toHaveTextContent('High confidence (100%)');
    });
  });
});
