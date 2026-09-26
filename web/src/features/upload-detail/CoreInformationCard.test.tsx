import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExtractionConfidence, LabelExtraction } from '@label-extractor/shared';
import { detail } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { CoreInformationCard } from './CoreInformationCard';

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

function renderCard(result: LabelExtraction, confidence: ExtractionConfidence | null = null) {
  renderWithProviders(<CoreInformationCard upload={{ ...detail({ fieldConfidence: confidence }), result }} />);
  return screen.getByRole('region', { name: 'Core information' });
}

describe('CoreInformationCard', () => {
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

      expect(within(card).getByText('97% confident')).toHaveClass('text-muted-foreground');
      expect(within(card).getByText('72% confident')).toHaveTextContent('72% confident, worth checking');
      expect(within(card).getByText('72% confident')).toHaveClass('text-warning');
      expect(within(card).getByText('45% confident')).toHaveClass('text-danger');
      expect(within(card).getByText('Partly hidden by a fold.')).toBeInTheDocument();
      expect(within(card).getByText('No ingredient contains milk.')).toBeInTheDocument();
    });

    it('shows no scores for an extraction that was never scored', () => {
      const card = renderCard(full, null);
      expect(within(card).queryByText(/confident/)).not.toBeInTheDocument();
    });
  });
});
