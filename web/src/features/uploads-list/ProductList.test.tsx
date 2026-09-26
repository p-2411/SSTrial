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

describe('searching, filtering and picking products', () => {
  const OAT = summary({ id: 'a', productName: 'Barista Oat Milk' });
  const GRANOLA = summary({ id: 'b', productName: 'Maple Pecan Crunch' });

  /** Answers lists with `list(url)`, and POST /api/uploads/delete with every ID asked for. Returns the requests. */
  function stubApi(list: (url: string) => UploadSummary[]) {
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ url, body });
        if (url === '/api/uploads/delete') return jsonResponse({ deleted: body.ids });
        return jsonResponse({ uploads: list(url), nextCursor: null });
      }),
    );
    return requests;
  }

  it('searches by what was typed, once typing pauses, and filters by when products were added', async () => {
    const requests = stubApi((url) => (url.includes('q=oat') ? [OAT] : [OAT, GRANOLA]));
    renderWithProviders(<ProductList />);
    await screen.findByText('Maple Pecan Crunch');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search products' }), 'oat');
    await vi.waitFor(() => expect(requests.at(-1)?.url).toBe('/api/uploads?view=products&q=oat'));
    await vi.waitFor(() => expect(screen.queryByText('Maple Pecan Crunch')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Added any time' }));
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    // The last 7 days, counting today, as the viewer's own midnights: to the start of tomorrow.
    const today = new Date();
    const midnight = (daysFromToday: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysFromToday).toISOString();
    const days = new URLSearchParams({ from: midnight(-6), to: midnight(1) });
    await vi.waitFor(() => expect(requests.at(-1)?.url).toBe(`/api/uploads?view=products&q=oat&${days}`));
    expect(screen.getByRole('button', { name: 'Added last 7 days' })).toBeInTheDocument();
  });

  it('says when nothing matches, and clears the search and filter', async () => {
    const requests = stubApi((url) => (url.includes('q=') ? [] : [OAT]));
    renderWithProviders(<ProductList />);
    await screen.findByText('Barista Oat Milk');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search products' }), 'barley{Enter}');
    expect(await screen.findByText('No products match')).toBeInTheDocument();
    expect(requests.at(-1)?.url).toBe('/api/uploads?view=products&q=barley');
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByText('Barista Oat Milk')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search products' })).toHaveValue('');
  });

  it('picks products one by one, and exports just those', async () => {
    stubApi(() => [OAT, GRANOLA]);
    renderWithProviders(<ProductList />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Barista Oat Milk' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Maple Pecan Crunch' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByText('2 products selected')).toBeInTheDocument();
  });

  it('deletes the picked products together, once the person confirms', async () => {
    const requests = stubApi(() => [OAT, GRANOLA]);
    renderWithProviders(<ProductList />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Barista Oat Milk' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Maple Pecan Crunch' }));

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete 2 products?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => expect(requests).toContainEqual({ url: '/api/uploads/delete', body: { ids: ['a', 'b'] } }));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
