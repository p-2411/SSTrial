import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadDetail } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { detail } from '@/test/fixtures';
import { panelWidth, UploadDetailPanel } from './UploadDetailPanel.tsx';

/** Uploads the fake API can return, by ID. "nameless" is a read label with no product name on it. */
const uploads: Record<string, UploadDetail> = Object.fromEntries(
  [
    ['abc', 'granola-label.png', 'Maple Pecan Crunch'],
    ['def', 'oat-milk.png', 'Barista Oat Milk'],
    ['nameless', 'back-of-pack.png', null],
    ['mine', 'my-label.png', 'My Crackers'],
    ['reading', 'still-reading.png', null],
  ].map(([id, fileName, productName]) => [
    id,
    detail({
      id: id!,
      fileName: fileName!,
      productName,
      status: id === 'reading' ? 'processing' : 'completed',
      result: { productName: productName ?? null, brand: null, ingredients: [], allergens: [], netWeight: null },
      // Only "mine" may be deleted by whoever is signed in here (the server decides; see canDelete).
      canDelete: id === 'mine',
      // Only "abc" was scored.
      confidence: id === 'abc' ? 72 : null,
      // "def" has been reviewed: a check, then a later edit.
      fieldReviews:
        id === 'def'
          ? {
              brand: { kind: 'checked', by: 'bob@example.com', at: '2026-09-25T09:00:00.000Z' },
              productName: { kind: 'edited', by: 'alice@example.com', at: '2026-09-25T10:00:00.000Z' },
            }
          : {},
    }),
  ]),
);

/** What the fake API answers a DELETE with. */
let deleteResponse: () => Response;

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
  deleteResponse = () => new Response(null, { status: 204 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? deleteResponse() : jsonResponse({ upload: uploads[url.split('/').pop()!] }),
    ),
  );
});

const deleteCalls = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE');

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

  it('invites a check in the status pill when the upload is worth checking', async () => {
    renderAt('/uploads/abc');
    const panel = await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });
    const pill = within(panel).getByText('Check');
    expect(pill).toHaveClass('text-warning');
    expect(pill).toHaveTextContent('72%');

    await userEvent.click(screen.getByRole('link', { name: 'Open oat milk' }));
    const unscored = await screen.findByRole('complementary', { name: 'Barista Oat Milk' });
    expect(within(unscored).getByText('Completed')).toBeInTheDocument();
  });

  it('says who last reviewed the data, once, in the header', async () => {
    renderAt('/uploads/def');
    const panel = await screen.findByRole('complementary', { name: 'Barista Oat Milk' });
    const lastEdited = within(panel).getByText('Last edited', { selector: 'dt' }).parentElement!;
    expect(lastEdited).toHaveTextContent('by alice@example.com');
    expect(within(panel).queryByText(/bob@example\.com/)).not.toBeInTheDocument();
  });

  it('has a handle on its left edge to widen it, which the keyboard can reach', async () => {
    renderAt('/uploads/abc');
    await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });
    const handle = screen.getByRole('separator', { name: 'Resize details panel' });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('is never narrower than its default width, nor so wide it crowds out the list', () => {
    // jsdom can't apply min()/clamp(), so the width itself is checked as CSS.
    expect(panelWidth(null)).toBe('min(42rem, 55cqw)');
    expect(panelWidth(900)).toBe('clamp(min(42rem, 55cqw), 900px, max(min(42rem, 55cqw), calc(100cqw - 30rem)))');
  });

  it("shows an upload that's still being read as loading, not as a half-finished page", async () => {
    renderAt('/uploads/reading');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/uploads/reading', expect.anything()));
    await new Promise((resolve) => setTimeout(resolve, 20)); // its data has arrived by now

    // Named after its heading, which still says it's loading: nothing half-finished is shown.
    expect(screen.getByRole('complementary', { name: 'Loading upload' })).toBeInTheDocument();
    expect(screen.queryByText('still-reading.png')).not.toBeInTheDocument();
  });

  describe('deleting', () => {
    it('is offered only to those who may delete the upload', async () => {
      renderAt('/uploads/abc');
      await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });
      expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('link', { name: 'Open oat milk' }));
      await screen.findByRole('complementary', { name: 'Barista Oat Milk' });
      expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
    });

    it('asks first, then deletes and closes the panel, keeping the status filter', async () => {
      renderAt('/uploads/mine?status=completed');
      await screen.findByRole('complementary', { name: 'My Crackers' });

      await userEvent.click(screen.getByRole('button', { name: 'Delete product' }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete My Crackers?' });
      // The product is what's deleted; its file goes with it.
      expect(dialog).toHaveTextContent('Its data and its file, my-label.png, are removed for good');
      expect(deleteCalls()).toHaveLength(0);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(deleteCalls().map(([url]) => url)).toEqual(['/api/uploads/mine']);
      await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/?status=completed'));
    });

    it('keeps the upload when the person changes their mind', async () => {
      renderAt('/uploads/mine');
      await screen.findByRole('complementary', { name: 'My Crackers' });

      await userEvent.click(screen.getByRole('button', { name: 'Delete product' }));
      await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));

      expect(deleteCalls()).toHaveLength(0);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByTestId('url')).toHaveTextContent('/uploads/mine');
    });

    it('says why when the server refuses, and stays open', async () => {
      deleteResponse = () =>
        jsonResponse({ error: { code: 'FORBIDDEN', message: 'Only the person who uploaded this, or an admin, can delete it.' } }, 403);
      renderAt('/uploads/mine');
      await screen.findByRole('complementary', { name: 'My Crackers' });

      await userEvent.click(screen.getByRole('button', { name: 'Delete product' }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete My Crackers?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only the person who uploaded this, or an admin, can delete it.');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument(); // still asking
      expect(screen.getByTestId('url')).toHaveTextContent('/uploads/mine');
    });
  });
});
