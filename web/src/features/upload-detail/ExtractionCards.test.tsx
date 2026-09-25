import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LabelExtraction } from '@label-extractor/shared';
import { CoreInformationCard } from './ExtractionCards';

const full: LabelExtraction = {
  productName: 'Barista Oat Milk',
  brand: 'Meadow & Mill',
  ingredients: ['Water', 'oats (10%)', 'sea salt'],
  allergens: ['oats', 'gluten'],
  netWeight: { value: 1, unit: 'l', text: '1 L' },
};

const empty: LabelExtraction = { productName: null, brand: null, ingredients: [], allergens: [], netWeight: null };

function renderCard(result: LabelExtraction) {
  render(<CoreInformationCard result={result} />);
  return screen.getByRole('region', { name: 'Core information' });
}

describe('CoreInformationCard', () => {
  it('shows every extracted field in one card, and that the data was validated', () => {
    const card = renderCard(full);

    expect(within(card).getByText('Barista Oat Milk')).toBeInTheDocument();
    expect(within(card).getByText('Meadow & Mill')).toBeInTheDocument();
    expect(within(card).getByText('Contains oats, gluten.')).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Water', 'oats (10%)', 'sea salt']);
    expect(within(card).getByText('Validated against the label schema')).toBeInTheDocument();
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
  });
});
