import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadDetail } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { summary } from '../../test/fixtures.ts';
import { UploadDetailPanel } from './UploadDetailPanel.tsx';

/** Two uploads the fake API can return, by ID. */
const uploads: Record<string, UploadDetail> = Object.fromEntries(
  [
    ['abc', 'granola-label.png', 'Maple Pecan Crunch'],
    ['def', 'oat-milk.png', 'Barista Oat Milk'],
  ].map(([id, fileName, productName]) => [
    id,
    {
      ...summary({ id, fileName, productName }),
      result: { productName: productName!, brand: null, ingredients: [], allergens: [], netWeight: null },
      fileUrl: null,
    },
  ]),
);

/** Shows the current URL, and a link to another upload (standing in for a list row). */
function Harness() {
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="url">{pathname + search}</output>
      <Link to="/uploads/def">Open oat milk</Link>
    </>
  );
}

function renderAt(url: string) {
  return renderWithProviders(
    <>
      <Harness />
      <UploadDetailPanel />
    </>,
    { url },
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => jsonResponse({ upload: uploads[url.split('/').pop()!] })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('UploadDetailPanel', () => {
  it('shows nothing on the list', () => {
    renderAt('/?status=failed');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('opens beside the list for /uploads/:id, named after the file', async () => {
    renderAt('/uploads/abc');

    expect(await screen.findByRole('complementary', { name: 'granola-label.png' })).toBeInTheDocument();
    expect(screen.getByText('Maple Pecan Crunch')).toBeInTheDocument();
  });

  it('swaps to another upload without closing when a different row is chosen', async () => {
    renderAt('/uploads/abc');
    await screen.findByRole('complementary', { name: 'granola-label.png' });

    await userEvent.click(screen.getByRole('link', { name: 'Open oat milk' }));

    expect(await screen.findByRole('complementary', { name: 'oat-milk.png' })).toBeInTheDocument();
    expect(screen.getByText('Barista Oat Milk')).toBeInTheDocument();
  });

  it.each([
    ['the close button', () => userEvent.click(screen.getByRole('button', { name: 'Close details' }))],
    ['Esc', () => userEvent.keyboard('{Escape}')],
  ])('closes with %s, returning to the list with the status filter kept', async (_how, closePanel) => {
    renderAt('/uploads/abc?status=completed');
    await screen.findByRole('complementary', { name: 'granola-label.png' });

    await closePanel();

    expect(screen.getByTestId('url')).toHaveTextContent('/?status=completed');
  });
});
