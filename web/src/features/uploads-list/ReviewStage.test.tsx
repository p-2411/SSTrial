import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadSummary } from '@label-extractor/shared';
import { summary } from '@/test/fixtures';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { ReviewStage } from './ReviewStage.tsx';

afterEach(() => vi.unstubAllGlobals());

const inReview = (id: string, productName: string, confidence: number | null) =>
  summary({ id, productName, fileName: `${id}.png`, confidence, submittedAt: null });

/** Answers the Review list with `uploads`, and the review actions as given. Returns what was posted where. */
function stubReview(uploads: UploadSummary[], answers: { submitted?: string[]; checked?: string[] } = {}) {
  const posted: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        return jsonResponse(url.endsWith('/submit') ? { submitted: answers.submitted ?? [] } : { checked: answers.checked ?? [] });
      }
      return jsonResponse({ uploads, nextCursor: null });
    }),
  );
  return posted;
}

describe('ReviewStage', () => {
  it('shows nothing while nothing is waiting for review', async () => {
    const fetch = vi.fn(async () => jsonResponse({ uploads: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetch);
    renderWithProviders(<ReviewStage />);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/uploads?view=review', expect.anything()));
    expect(screen.queryByRole('region', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('marks what can go in as ready, and what must be checked first', async () => {
    stubReview([inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('c', 'Sea Salt Crackers', 40)]);
    renderWithProviders(<ReviewStage />);

    const card = await screen.findByRole('region', { name: 'Review' });
    const rows = await within(card).findAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ready'),
      expect.stringContaining('Check (72%)'),
      expect.stringContaining('Check (40%)'),
    ]);
    expect(within(card).getByRole('button', { name: 'Submit all ready (1)' })).toBeEnabled();
  });

  it('submits only the ready ones', async () => {
    const posted = stubReview([inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('d', 'Checked Tea', null)], {
      submitted: ['a', 'd'],
    });
    renderWithProviders(<ReviewStage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Submit all ready (2)' }));

    await vi.waitFor(() => expect(posted).toEqual([{ url: '/api/uploads/submit', body: { ids: ['a', 'd'] } }]));
  });

  it("can't submit anything until something is ready", async () => {
    stubReview([inReview('b', 'Barista Oat Milk', 72)]);
    renderWithProviders(<ReviewStage />);

    expect(await screen.findByRole('button', { name: 'Submit all ready' })).toBeDisabled();
  });

  it('marks every flagged product as checked, once the person confirms', async () => {
    const posted = stubReview([inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('c', 'Sea Salt Crackers', 40)], {
      checked: ['b', 'c'],
    });
    renderWithProviders(<ReviewStage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as checked' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Mark 2 products as checked?' });
    expect(posted).toEqual([]); // nothing until they confirm

    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as checked' }));

    await vi.waitFor(() => expect(posted).toEqual([{ url: '/api/uploads/check', body: { ids: ['b', 'c'] } }]));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('acts on just the ticked ones, when some are', async () => {
    const posted = stubReview([inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('c', 'Sea Salt Crackers', 95)], {
      submitted: ['c'],
    });
    renderWithProviders(<ReviewStage />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Barista Oat Milk' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sea Salt Crackers' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark 1 as checked' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Submit 1 ready' }));

    await vi.waitFor(() => expect(posted).toEqual([{ url: '/api/uploads/submit', body: { ids: ['c'] } }]));
  });

  it('offers no bulk check when nothing is flagged', async () => {
    stubReview([inReview('a', 'Maple Pecan Crunch', 92)]);
    renderWithProviders(<ReviewStage />);

    await screen.findByRole('region', { name: 'Review' });
    expect(screen.queryByRole('button', { name: 'Mark all as checked' })).not.toBeInTheDocument();
  });
});
