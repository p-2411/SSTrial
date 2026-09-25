import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadDetail } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { summary } from '../../test/fixtures.ts';
import { UploadDetailSheet } from './UploadDetailSheet.tsx';

const upload: UploadDetail = {
  ...summary({ id: 'abc', fileName: 'granola-label.png' }),
  result: {
    productName: 'Maple Pecan Crunch',
    brand: 'Harvest & Hearth',
    ingredients: [],
    allergens: [],
    netWeight: null,
  },
  fileUrl: null,
};

/** Shows the current URL, so tests can see where closing the sheet navigates to. */
function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <output data-testid="url">{pathname + search}</output>;
}

function renderAt(url: string) {
  return renderWithProviders(
    <>
      <UploadDetailSheet />
      <CurrentUrl />
    </>,
    { url },
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ upload })));
});

afterEach(() => vi.unstubAllGlobals());

describe('UploadDetailSheet', () => {
  it('stays closed on the list', () => {
    renderAt('/?status=failed');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens for /uploads/:id, named after the file', async () => {
    renderAt('/uploads/abc');

    expect(await screen.findByRole('dialog', { name: 'granola-label.png' })).toBeInTheDocument();
    expect(screen.getByText('Maple Pecan Crunch')).toBeInTheDocument();
  });

  it('closing returns to the list and keeps the status filter', async () => {
    renderAt('/uploads/abc?status=completed');
    await screen.findByRole('dialog', { name: 'granola-label.png' });

    await userEvent.keyboard('{Escape}');

    expect(screen.getByTestId('url')).toHaveTextContent('/?status=completed');
  });
});
