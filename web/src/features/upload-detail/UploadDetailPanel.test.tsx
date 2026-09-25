import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadDetail } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { detail } from '@/test/fixtures';
import { UploadDetailPanel } from './UploadDetailPanel.tsx';

/** Uploads the fake API can return, by ID. "nameless" is a read label with no product name on it. */
const uploads: Record<string, UploadDetail> = Object.fromEntries(
  [
    ['abc', 'granola-label.png', 'Maple Pecan Crunch'],
    ['def', 'oat-milk.png', 'Barista Oat Milk'],
    ['nameless', 'back-of-pack.png', null],
  ].map(([id, fileName, productName]) => [
    id,
    detail({
      id: id!,
      fileName: fileName!,
      productName,
      result: { productName: productName ?? null, brand: null, ingredients: [], allergens: [], netWeight: null },
    }),
  ]),
);

/** Shows the current URL, and a link to another upload (standing in for a list row). */
function Harness() {
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="url">{pathname + search}</output>
      <Link to="/uploads/def">Open oat milk</Link>
      <Link to="/uploads/abc">Open granola</Link>
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

  it('opens beside the list for /uploads/:id, titled with the product name', async () => {
    renderAt('/uploads/abc');

    expect(await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Maple Pecan Crunch' })).toBeInTheDocument();
    // The file name moves down to the metadata row, beside its type and size.
    const fileFact = screen.getByText('File').parentElement!;
    expect(fileFact).toHaveTextContent('granola-label.pngPNG, 48.8 KB');
  });

  it('falls back to the file name as the title when the label had no product name', async () => {
    renderAt('/uploads/nameless');

    expect(await screen.findByRole('heading', { level: 2, name: 'back-of-pack.png' })).toBeInTheDocument();
    // Not repeated in the metadata row.
    expect(screen.getByText('File').parentElement).toHaveTextContent('FilePNG, 48.8 KB');
  });

  it("closes an open editor when another upload is chosen, so a draft can't be saved to the wrong one", async () => {
    renderAt('/uploads/def');
    await screen.findByRole('complementary', { name: 'Barista Oat Milk' }); // now cached
    await userEvent.click(screen.getByRole('link', { name: 'Open granola' }));
    await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit product name' }));

    await userEvent.click(screen.getByRole('link', { name: 'Open oat milk' }));

    expect(await screen.findByRole('complementary', { name: 'Barista Oat Milk' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Product name' })).not.toBeInTheDocument();
  });

  it('swaps to another upload without closing when a different row is chosen', async () => {
    renderAt('/uploads/abc');
    await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });

    await userEvent.click(screen.getByRole('link', { name: 'Open oat milk' }));

    expect(await screen.findByRole('complementary', { name: 'Barista Oat Milk' })).toBeInTheDocument();
  });

  it.each([
    ['the close button', () => userEvent.click(screen.getByRole('button', { name: 'Close details' }))],
    ['Esc', () => userEvent.keyboard('{Escape}')],
  ])('closes with %s, returning to the list with the status filter kept', async (_how, closePanel) => {
    renderAt('/uploads/abc?status=completed');
    await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });

    await closePanel();

    expect(screen.getByTestId('url')).toHaveTextContent('/?status=completed');
  });
});
