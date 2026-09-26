import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { detail } from '@/test/fixtures';
import { StatusNotice } from '../StatusNotice.tsx';

describe('StatusNotice', () => {
  it('explains a result that can no longer be read and offers to run it again', () => {
    renderWithProviders(<StatusNotice upload={detail({ status: 'completed', resultUnreadable: true, canRetry: true })} />);

    expect(screen.getByRole('alert')).toHaveTextContent("This result can't be displayed");
    expect(screen.getByRole('button', { name: 'Run extraction again' })).toBeInTheDocument();
  });

  it('says who can run it again, to someone who may not', () => {
    renderWithProviders(<StatusNotice upload={detail({ status: 'completed', resultUnreadable: true, canRetry: false })} />);

    expect(screen.queryByRole('button', { name: 'Run extraction again' })).not.toBeInTheDocument();
    expect(screen.getByText('Whoever uploaded it, or an admin, can run it again.')).toBeVisible();
  });

  it('shows nothing for a completed upload whose result reads fine', () => {
    const { container } = renderWithProviders(<StatusNotice upload={detail({ status: 'completed' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a retry for a failure the file did not cause', () => {
    renderWithProviders(
      <StatusNotice upload={detail({ status: 'failed', error: { code: 'LLM_TIMEOUT', message: 'Took too long to read.' }, canRetry: true })} />,
    );
    expect(screen.getByRole('button', { name: 'Retry extraction' })).toBeInTheDocument();
  });
});
