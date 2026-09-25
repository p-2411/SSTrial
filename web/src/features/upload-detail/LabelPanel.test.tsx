import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LabelExtraction } from '@label-extractor/shared';
import { LabelPanel } from './LabelPanel.tsx';

const full: LabelExtraction = {
  productName: 'Barista Oat Milk',
  brand: 'Meadow & Mill',
  ingredients: ['Water', 'oats (10%)', 'sea salt'],
  allergens: ['oats', 'gluten'],
  netWeight: { value: 1, unit: 'l', text: '1 L' },
};

describe('LabelPanel', () => {
  it('shows every extracted field', () => {
    render(<LabelPanel result={full} />);

    expect(screen.getByRole('heading', { name: 'Barista Oat Milk' })).toBeInTheDocument();
    expect(screen.getByText('Meadow & Mill')).toBeInTheDocument();
    expect(screen.getByText('Contains oats, gluten.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Water', 'oats (10%)', 'sea salt']);
  });

  it('labels liquids as volume, writes litres as L, and skips a redundant "printed as"', () => {
    render(<LabelPanel result={full} />);

    expect(screen.getByRole('heading', { name: 'Net volume' })).toBeInTheDocument();
    expect(screen.getByText('1 L')).toBeInTheDocument();
    expect(screen.queryByText(/Printed as/)).not.toBeInTheDocument();
  });

  it('keeps the printed wording when it adds information', () => {
    render(<LabelPanel result={{ ...full, netWeight: { value: 500, unit: 'g', text: 'Net Wt 500 g (17.6 oz)' } }} />);

    expect(screen.getByRole('heading', { name: 'Net weight' })).toBeInTheDocument();
    expect(screen.getByText('Printed as “Net Wt 500 g (17.6 oz)”')).toBeInTheDocument();
  });

  it('says explicitly when something was not on the label', () => {
    render(
      <LabelPanel result={{ productName: 'Plain Rice', brand: null, ingredients: [], allergens: [], netWeight: null }} />,
    );

    expect(screen.getByText('Brand not found on label')).toBeInTheDocument();
    expect(screen.getByText('No allergens declared on label')).toBeInTheDocument();
    expect(screen.getByText('No ingredient list found on label')).toBeInTheDocument();
    expect(screen.getByText('Not found on label')).toBeInTheDocument();
  });
});
