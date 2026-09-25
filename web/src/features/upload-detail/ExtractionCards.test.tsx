import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LabelExtraction } from '@label-extractor/shared';
import { AllergensCard, CoreInformationCard, IngredientsCard } from './ExtractionCards';

const full: LabelExtraction = {
  productName: 'Barista Oat Milk',
  brand: 'Meadow & Mill',
  ingredients: ['Water', 'oats (10%)', 'sea salt'],
  allergens: ['oats', 'gluten'],
  netWeight: { value: 1, unit: 'l', text: '1 L' },
};

describe('CoreInformationCard', () => {
  it('shows the product name, brand and quantity, and that the data was validated', () => {
    render(<CoreInformationCard result={full} />);
    const card = screen.getByRole('region', { name: 'Core information' });

    expect(within(card).getByText('Barista Oat Milk')).toBeInTheDocument();
    expect(within(card).getByText('Meadow & Mill')).toBeInTheDocument();
    expect(within(card).getByText('Validated against the label schema')).toBeInTheDocument();
  });

  it('labels liquids as volume, writes litres as L, and skips a redundant "printed as"', () => {
    render(<CoreInformationCard result={full} />);

    expect(screen.getByText('Net volume')).toBeInTheDocument();
    expect(screen.getByText('1 L')).toBeInTheDocument();
    expect(screen.queryByText(/Printed as/)).not.toBeInTheDocument();
  });

  it('keeps the printed wording when it adds information', () => {
    render(<CoreInformationCard result={{ ...full, netWeight: { value: 500, unit: 'g', text: 'Net Wt 500 g (17.6 oz)' } }} />);

    expect(screen.getByText('Net weight')).toBeInTheDocument();
    expect(screen.getByText('Printed as “Net Wt 500 g (17.6 oz)”')).toBeInTheDocument();
  });

  it('says explicitly when a field was not on the label', () => {
    render(<CoreInformationCard result={{ ...full, brand: null, netWeight: null }} />);
    expect(screen.getAllByText('Not found on label')).toHaveLength(2);
  });
});

describe('AllergensCard', () => {
  it('lists each declared allergen, with a sentence for screen readers', () => {
    render(<AllergensCard allergens={['oats', 'gluten']} />);

    expect(screen.getByText('Contains oats, gluten.')).toBeInTheDocument();
    expect(screen.getByText('oats')).toBeInTheDocument();
  });

  it('says when no allergens are declared', () => {
    render(<AllergensCard allergens={[]} />);
    expect(screen.getByText('No allergens declared on label')).toBeInTheDocument();
  });
});

describe('IngredientsCard', () => {
  it('lists ingredients in label order with a count', () => {
    render(<IngredientsCard ingredients={full.ingredients} />);

    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Water', 'oats (10%)', 'sea salt']);
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('says when there is no ingredient list', () => {
    render(<IngredientsCard ingredients={[]} />);
    expect(screen.getByText('No ingredient list found on label')).toBeInTheDocument();
  });
});
