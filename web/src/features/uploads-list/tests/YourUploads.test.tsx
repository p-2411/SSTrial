import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { UploadSummary } from '@label-extractor/shared';
import { uploadKeys } from '@/api/queries';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { summary } from '@/test/fixtures';
import { jsonResponse, stubFetch } from '@/test/fetch';
import { Providers, renderWithProviders } from '@/test/render';
import { YourUploads } from '../YourUploads.tsx';

/** What the server has in each of the person's lists. */
let uploading: UploadSummary[] = [];
let review: UploadSummary[] = [];

/** Answers both lists, and the batch actions as given. Returns every request, and what was posted where. */
function stubApi(answers: { submitted?: string[]; checked?: string[]; deleted?: string[] } = {}) {
  const requests = stubFetch(({ url, method }) => {
    if (method === 'POST' && url.endsWith('/submit')) return jsonResponse({ submitted: answers.submitted ?? [] });
    if (method === 'POST' && url.endsWith('/check')) return jsonResponse({ checked: answers.checked ?? [] });
    if (method === 'POST' && url.endsWith('/delete')) return jsonResponse({ deleted: answers.deleted ?? [] });
    return jsonResponse({ uploads: url.includes('view=review') ? review : uploading, nextCursor: null });
  });
  const posted = () => requests.filter(({ method }) => method === 'POST').map(({ url, body }) => ({ url, body }));
  return { requests, posted };
}

const sending = (name: string): PendingUpload => ({
  localId: name,
  file: new File(['x'], name, { type: 'image/png' }),
  mimeType: 'image/png',
  phase: 'uploading',
  progress: 0.4,
  error: null,
});

const inReview = (id: string, productName: string, confidence: number | null) =>
  summary({ id, productName, fileName: `${id}.png`, confidence, submittedAt: null });

const couldNotRead = (id: string, fileName: string) =>
  summary({ id, fileName, status: 'failed', productName: null, error: { code: 'NO_LABEL_DATA', message: "Couldn't find any product label information in this file." } });

const neverSent = (name: string): PendingUpload => ({ ...sending(name), phase: 'failed', progress: 0, error: 'The connection dropped.' });

const renderYours = (pending: PendingUpload[] = [], onDismiss: (localId: string) => void = () => {}) =>
  renderWithProviders(<YourUploads pending={pending} onRetry={() => {}} onDismiss={onDismiss} />);

describe('YourUploads', () => {
  it("asks for the person's own lists, holding their place while they load, and shows nothing when both are empty", async () => {
    uploading = [];
    review = [];
    const { requests } = stubApi();
    renderYours();

    // The card's place is held while the lists load, so the page doesn't jump when they arrive.
    const card = screen.getByRole('region', { name: 'Your uploads' });
    expect(within(card).getByRole('status', { name: 'Loading your uploads' })).toBeInTheDocument();

    await vi.waitFor(() => expect(requests.map(({ url }) => url)).toEqual(expect.arrayContaining(['/api/uploads?view=upload', '/api/uploads?view=review'])));
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Your uploads' })).not.toBeInTheDocument());
  });

  it('replaces the placeholder with the lists once they arrive', async () => {
    uploading = [];
    review = [inReview('r', 'Maple Pecan Crunch', 92)];
    stubApi();
    renderYours();

    expect(await screen.findByRole('list', { name: 'Review' })).toHaveTextContent('Maple Pecan Crunch');
    expect(screen.queryByRole('status', { name: 'Loading your uploads' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Your uploads' })).toHaveLength(1);
  });

  it("shows files still being sent, then the server's, under Uploading", async () => {
    uploading = [
      summary({ id: 'q', fileName: 'waiting.png', status: 'queued', productName: null }),
      summary({ id: 'f', fileName: 'broken.png', status: 'failed', productName: null, error: { code: 'LLM_TIMEOUT', message: 'Reading the label took too long.' } }),
    ];
    review = [inReview('r', 'Maple Pecan Crunch', 92)];
    stubApi();
    renderYours([sending('sending.png')]);

    const rows = await screen.findByRole('list', { name: 'Uploading' });
    await within(rows).findByText('waiting.png');
    expect(within(rows).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('sending.png'),
      expect.stringContaining('waiting.png'),
      expect.stringContaining('broken.png'),
    ]);
    expect(screen.getByRole('tab', { name: 'Uploading 3' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Review 1' })).toBeInTheDocument();
    // A failed upload opens; one still being worked on has nothing to open yet.
    expect(within(rows).getAllByRole('link')).toHaveLength(1);
  });

  it('shows Review when nothing is uploading, and moves there when the last upload is read', async () => {
    uploading = [summary({ id: 'q', fileName: 'granola.png', status: 'processing', productName: null })];
    review = [];
    stubApi();
    const { client } = renderYours();
    await screen.findByText('granola.png');

    uploading = [];
    review = [inReview('q', 'Maple Pecan Crunch', 92)];
    await act(() => client.invalidateQueries({ queryKey: uploadKeys.lists() }));

    expect(await screen.findByRole('list', { name: 'Review' })).toHaveTextContent('Maple Pecan Crunch');
    expect(screen.getByRole('tab', { name: 'Review 1' })).toHaveAttribute('aria-selected', 'true');
    // An empty tab isn't offered.
    expect(screen.queryByRole('tab', { name: /Uploading/ })).not.toBeInTheDocument();
    // Announced too, for anyone who can't see the rows move.
    expect(screen.getByText('granola.png is ready to review.')).toBeInTheDocument();
  });

  it('brings Uploading to the front when new files are on their way', async () => {
    uploading = [];
    review = [inReview('r', 'Maple Pecan Crunch', 92)];
    stubApi();
    const { client, rerender } = renderYours();
    await screen.findByRole('list', { name: 'Review' });

    rerender(
      <Providers client={client}>
        <YourUploads pending={[sending('new.png')]} onRetry={() => {}} onDismiss={() => {}} />
      </Providers>,
    );

    expect(await screen.findByRole('tab', { name: 'Uploading 1' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('YourUploads — Review', () => {
  it('marks what can go in as ready, and what must be checked first', async () => {
    uploading = [];
    review = [inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('c', 'Sea Salt Crackers', 40)];
    stubApi();
    renderYours();

    const rows = within(await screen.findByRole('list', { name: 'Review' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ready'),
      expect.stringContaining('Check (72%)'),
      expect.stringContaining('Check (40%)'),
    ]);
    expect(screen.getByRole('button', { name: 'Submit all ready (1)' })).toBeEnabled();
  });

  it('submits only the ready ones', async () => {
    uploading = [];
    review = [inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('d', 'Checked Tea', null)];
    const { posted } = stubApi({ submitted: ['a', 'd'] });
    renderYours();

    await userEvent.click(await screen.findByRole('button', { name: 'Submit all ready (2)' }));

    await vi.waitFor(() => expect(posted()).toEqual([{ url: '/api/uploads/submit', body: { ids: ['a', 'd'] } }]));
  });

  it("can't submit anything until something is ready", async () => {
    uploading = [];
    review = [inReview('b', 'Barista Oat Milk', 72)];
    stubApi();
    renderYours();

    const submit = await screen.findByRole('button', { name: 'Submit all ready' });
    expect(submit).toBeDisabled();
    // And says why, in its description and on hover.
    expect(submit).toHaveAccessibleDescription('Check the flagged products first');
    await userEvent.hover(submit.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Check the flagged products first');
  });

  it('marks every flagged product as checked, once the person confirms', async () => {
    uploading = [];
    review = [inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('c', 'Sea Salt Crackers', 40)];
    const { posted } = stubApi({ checked: ['b', 'c'] });
    renderYours();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as checked' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Mark 2 products as checked?' });
    expect(posted()).toEqual([]); // nothing until they confirm

    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as checked' }));

    await vi.waitFor(() => expect(posted()).toEqual([{ url: '/api/uploads/check', body: { ids: ['b', 'c'] } }]));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('acts on just the ticked ones, when some are', async () => {
    uploading = [];
    review = [inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72), inReview('c', 'Sea Salt Crackers', 95)];
    const { posted } = stubApi({ submitted: ['c'] });
    renderYours();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Barista Oat Milk' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sea Salt Crackers' }));
    expect(screen.getByRole('button', { name: 'Mark 1 as checked' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Submit 1 ready' }));

    await vi.waitFor(() => expect(posted()).toEqual([{ url: '/api/uploads/submit', body: { ids: ['c'] } }]));
  });

  it('selects all, and deselects all', async () => {
    uploading = [];
    review = [inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72)];
    stubApi();
    renderYours();

    await userEvent.click(await screen.findByRole('button', { name: 'Select all' }));
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Submit 1 ready' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
  });

  it('offers no bulk check when nothing is flagged', async () => {
    uploading = [];
    review = [inReview('a', 'Maple Pecan Crunch', 92)];
    stubApi();
    renderYours();

    await screen.findByRole('list', { name: 'Review' });
    expect(screen.queryByRole('button', { name: 'Mark all as checked' })).not.toBeInTheDocument();
  });
});

describe('YourUploads — deleting from Review', () => {
  it('deletes the ticked ones, once the person confirms', async () => {
    uploading = [];
    review = [inReview('a', 'Maple Pecan Crunch', 92), inReview('b', 'Barista Oat Milk', 72)];
    const { posted } = stubApi({ deleted: ['b'] });
    renderYours();

    expect(await screen.findByRole('button', { name: 'Select all' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument(); // nothing ticked
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Barista Oat Milk' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete 1 upload?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => expect(posted()).toEqual([{ url: '/api/uploads/delete', body: { ids: ['b'] } }]));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

describe('YourUploads — dismissing failures', () => {
  it("dismisses every failure: files that never went at once, and uploads that couldn't be read once the person confirms", async () => {
    uploading = [summary({ id: 'q', fileName: 'waiting.png', status: 'queued', productName: null }), couldNotRead('f', 'blurry.png')];
    review = [];
    const { posted } = stubApi({ deleted: ['f'] });
    const onDismiss = vi.fn();
    renderYours([neverSent('dropped.png')], onDismiss);

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss all failed' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Dismiss 1 failed upload?' });
    expect(onDismiss).not.toHaveBeenCalled(); // not until the person confirms
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

    // The one still waiting to be read isn't a failure, so it stays.
    await vi.waitFor(() => expect(posted()).toEqual([{ url: '/api/uploads/delete', body: { ids: ['f'] } }]));
    await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledWith('dropped.png'));
  });

  it('dismisses files that never went straight away, with nothing to confirm', async () => {
    uploading = [];
    review = [];
    const { posted } = stubApi();
    const onDismiss = vi.fn();
    renderYours([neverSent('dropped.png'), sending('on-its-way.png')], onDismiss);

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss all failed' }));

    expect(onDismiss.mock.calls).toEqual([['dropped.png']]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(posted()).toEqual([]);
  });

  it('dismisses just the ticked failures, when some are', async () => {
    uploading = [couldNotRead('f1', 'blurry.png'), couldNotRead('f2', 'dark.png')];
    review = [];
    const { posted } = stubApi({ deleted: ['f2'] });
    const onDismiss = vi.fn();
    renderYours([neverSent('dropped.png')], onDismiss);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select dark.png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss 1' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Dismiss 1 failed upload?' })).getByRole('button', { name: 'Dismiss' }));

    await vi.waitFor(() => expect(posted()).toEqual([{ url: '/api/uploads/delete', body: { ids: ['f2'] } }]));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("closes the open upload's panel when it's among those dismissed", async () => {
    uploading = [couldNotRead('f', 'blurry.png')];
    review = [];
    stubApi({ deleted: ['f'] });
    function Where() {
      return <output aria-label="Location">{useLocation().pathname}</output>;
    }
    renderWithProviders(
      <>
        <YourUploads pending={[]} onRetry={() => {}} onDismiss={() => {}} />
        <Where />
      </>,
      { url: '/uploads/f' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss all failed' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dismiss' }));

    await vi.waitFor(() => expect(screen.getByRole('status', { name: 'Location' })).toHaveTextContent(/^\/$/));
  });

  it('offers no dismissing while nothing has failed', async () => {
    uploading = [summary({ id: 'q', fileName: 'waiting.png', status: 'queued', productName: null })];
    review = [];
    stubApi();
    renderYours([sending('on-its-way.png')]);

    await screen.findByText('waiting.png');
    expect(screen.queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
