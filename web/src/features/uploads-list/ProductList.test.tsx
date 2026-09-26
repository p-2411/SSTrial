import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadSummary } from '@label-extractor/shared';
import { summary } from '@/test/fixtures';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { ProductList } from './ProductList.tsx';

afterEach(() => vi.unstubAllGlobals());

/** Answers the products list with the given pages, one per request. Returns the URLs asked for. */
function stubProducts(...pages: Array<{ uploads: UploadSummary[]; nextCursor: string | null }>): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requested.push(input);
      return jsonResponse(pages[Math.min(requested.length - 1, pages.length - 1)]);
    }),
  );
  return requested;
}

describe('ProductList', () => {
  it("asks for everyone's finished products, and lists them", async () => {
    const requested = stubProducts({
      uploads: [summary({ id: 'a', productName: 'Maple Pecan Crunch' }), summary({ id: 'b', productName: 'Barista Oat Milk' })],
      nextCursor: null,
    });
    renderWithProviders(<ProductList />);

    const list = await screen.findByRole('region', { name: 'Products' });
    expect(await within(list).findByText('Maple Pecan Crunch')).toBeInTheDocument();
    expect(within(list).getByText('Barista Oat Milk')).toBeInTheDocument();
    expect(requested[0]).toBe('/api/uploads?view=products');
    // There's something to export.
    expect(within(list).getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('invites a first upload while there are none, and offers no export', async () => {
    stubProducts({ uploads: [], nextCursor: null });
    renderWithProviders(<ProductList />);

    expect(await screen.findByText('No products yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('loads the next page on "Load more"', async () => {
    const requested = stubProducts(
      { uploads: [summary({ id: 'a', productName: 'First' })], nextCursor: 'a' },
      { uploads: [summary({ id: 'b', productName: 'Second' })], nextCursor: null },
    );
    renderWithProviders(<ProductList />);

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(requested).toEqual(['/api/uploads?view=products', '/api/uploads?view=products&cursor=a']);
  });

  it('says why when it can’t load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    renderWithProviders(<ProductList />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the products");
  });
});
