import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadDetail } from '@label-extractor/shared';
import { uploadKeys } from '@/api/queries';
import { badGateway, jsonResponse, stubFetch, type SentRequest } from '@/test/fetch';
import { detail } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { UploadDetailPanel } from '../UploadDetailPanel.tsx';
import { panelWidth } from '../usePanelResize.ts';

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
/** What the fake API answers a GET with, if not the upload: its refusal, by ID. */
let refusals: Record<string, () => Response>;
/** Every request made. */
let requests: SentRequest[];

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
  refusals = {};
  requests = stubFetch(({ url, method }) => {
    const id = url.split('/').pop()!;
    if (method === 'DELETE') return deleteResponse();
    return refusals[id]?.() ?? jsonResponse({ upload: uploads[id] });
  });
});

const deletes = () => requests.filter(({ method }) => method === 'DELETE').map(({ url }) => url);

afterEach(() => vi.restoreAllMocks());

describe('UploadDetailPanel', () => {
  it('shows nothing on the list', () => {
    renderAt('/');
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
  ])('closes with %s, returning to the list', async (_how, closePanel) => {
    renderAt('/uploads/abc');
    await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });

    await closePanel();

    expect(screen.getByTestId('url')).toHaveTextContent(/^\/$/);
  });

  it('invites a check in the status pill when the upload is worth checking', async () => {
    renderAt('/uploads/abc');
    const panel = await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });
    expect(within(panel).getByText('Check')).toHaveTextContent('Completed, confidence 72%: Check (72%)');

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

  it("names an upload that's still being read, and says what's happening to it, rather than a half-finished page", async () => {
    renderAt('/uploads/reading');

    const panel = await screen.findByRole('complementary', { name: 'still-reading.png' });
    expect(within(panel).getByText('Processing')).toBeVisible(); // its status pill
    expect(within(panel).getByRole('status')).toHaveTextContent('Reading label');
    // Nothing to act on, and no empty data card, until it's read.
    expect(screen.queryByRole('region', { name: 'Product information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it.each([
    ['the close button', () => userEvent.click(screen.getByRole('button', { name: 'Close details' }))],
    ['Esc', () => userEvent.keyboard('{Escape}')],
  ])('moves focus to the title as it opens, and back to what opened it when closed with %s', async (_how, closePanel) => {
    renderAt('/');
    const opener = screen.getByRole('link', { name: 'Open granola' });
    await userEvent.click(opener);

    expect(await screen.findByRole('heading', { level: 2, name: 'Maple Pecan Crunch' })).toHaveFocus();
    await closePanel();

    expect(opener).toHaveFocus();
  });

  it('says so when the open upload is deleted meanwhile, and offers nothing to act on', async () => {
    const { client } = renderAt('/uploads/mine');
    await screen.findByRole('complementary', { name: 'My Crackers' });
    expect(screen.getByRole('button', { name: 'Delete product' })).toBeVisible();

    // Someone else deletes it; the next refresh finds it gone.
    refusals.mine = () => jsonResponse({ error: { code: 'NOT_FOUND', message: 'No such upload.' } }, 404);
    await act(() => client.invalidateQueries({ queryKey: uploadKeys.detail('mine') }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This upload has been deleted');
    expect(screen.getByRole('heading', { level: 2, name: 'My Crackers' })).toBeVisible(); // as it was
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("keeps showing the upload when a refresh fails, saying it may be out of date", async () => {
    const { client } = renderAt('/uploads/abc');
    await screen.findByRole('complementary', { name: 'Maple Pecan Crunch' });

    refusals.abc = badGateway;
    await act(() => client.invalidateQueries({ queryKey: uploadKeys.detail('abc') }));

    const panel = screen.getByRole('complementary', { name: 'Maple Pecan Crunch' });
    expect(await within(panel).findByText(/Couldn't refresh this upload, so it may be out of date/)).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('shows an upload it cannot display as a problem with that upload alone, and still closes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React reports the caught error
    // Data the page can't make sense of (no reviews at all, not even an empty set).
    uploads.broken = { ...uploads.abc!, id: 'broken', fieldReviews: null as unknown as UploadDetail['fieldReviews'] };
    renderAt('/uploads/broken');

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't show this upload");
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/$/);
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

    it('asks first, then deletes and closes the panel', async () => {
      renderAt('/uploads/mine');
      await screen.findByRole('complementary', { name: 'My Crackers' });

      await userEvent.click(screen.getByRole('button', { name: 'Delete product' }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete My Crackers?' });
      // The product is what's deleted; its file goes with it.
      expect(dialog).toHaveTextContent('Its data and its file, my-label.png, are removed for good');
      expect(deletes()).toEqual([]);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(deletes()).toEqual(['/api/uploads/mine']);
      await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/$/));
    });

    it('keeps the upload when the person changes their mind', async () => {
      renderAt('/uploads/mine');
      await screen.findByRole('complementary', { name: 'My Crackers' });

      await userEvent.click(screen.getByRole('button', { name: 'Delete product' }));
      await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));

      expect(deletes()).toEqual([]);
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
