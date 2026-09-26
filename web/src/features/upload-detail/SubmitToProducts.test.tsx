import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detail } from '@/test/fixtures';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { SubmitToProducts } from './SubmitToProducts';

afterEach(() => vi.unstubAllGlobals());

/** Answers POST /api/uploads/submit, and lists. Returns the bodies submitted. */
function stubSubmit() {
  const submits: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/uploads/submit') {
        submits.push(JSON.parse(String(init?.body)));
        return jsonResponse({ submitted: ['u1'] });
      }
      return jsonResponse({ uploads: [], nextCursor: null });
    }),
  );
  return submits;
}

describe('SubmitToProducts', () => {
  it('submits the upload to Products once nothing is left to check', async () => {
    const submits = stubSubmit();
    renderWithProviders(<SubmitToProducts upload={detail({ id: 'u1', submittedAt: null, confidence: 92 })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Submit to Products' }));

    await vi.waitFor(() => expect(submits).toEqual([{ ids: ['u1'] }]));
  });

  it('says what stands in the way while a field is flagged', () => {
    stubSubmit();
    renderWithProviders(<SubmitToProducts upload={detail({ id: 'u1', submittedAt: null, confidence: 72 })} />);

    expect(screen.getByRole('button', { name: 'Check the flagged fields to submit' })).toBeDisabled();
  });
});
