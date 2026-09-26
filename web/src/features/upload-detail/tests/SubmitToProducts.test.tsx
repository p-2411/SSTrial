import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { detail } from '@/test/fixtures';
import { jsonResponse, stubFetch } from '@/test/fetch';
import { renderWithProviders } from '@/test/render';
import { SubmitToProducts } from '../SubmitToProducts';

/** Answers POST /api/uploads/submit, and lists. Returns the bodies submitted. */
function stubSubmit() {
  const requests = stubFetch(({ url }) => jsonResponse(url === '/api/uploads/submit' ? { submitted: ['u1'] } : { uploads: [], nextCursor: null }));
  return () => requests.filter(({ url }) => url === '/api/uploads/submit').map(({ body }) => body);
}

describe('SubmitToProducts', () => {
  it('submits the upload to Products once nothing is left to check', async () => {
    const submits = stubSubmit();
    renderWithProviders(<SubmitToProducts upload={detail({ id: 'u1', submittedAt: null, confidence: 92 })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Submit to Products' }));

    await vi.waitFor(() => expect(submits()).toEqual([{ ids: ['u1'] }]));
  });

  it('says what stands in the way while a field is flagged', () => {
    stubSubmit();
    renderWithProviders(<SubmitToProducts upload={detail({ id: 'u1', submittedAt: null, confidence: 72 })} />);

    expect(screen.getByRole('button', { name: 'Check the flagged fields to submit' })).toBeDisabled();
  });
});
