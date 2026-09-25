import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { detail } from '@/test/fixtures';
import { StatusNotice } from './StatusNotice.tsx';


describe('StatusNotice', () => {
  it('explains a result that can no longer be read and offers to run it again', () => {
    renderWithProviders(<StatusNotice upload={detail({ status: 'completed', resultUnreadable: true })} />);

    expect(screen.getByRole('alert')).toHaveTextContent("This result can't be displayed");
    expect(screen.getByRole('button', { name: 'Run extraction again' })).toBeInTheDocument();
  });

  it('shows nothing for a completed upload whose result reads fine', () => {
    const { container } = renderWithProviders(<StatusNotice upload={detail({ status: 'completed' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a retry for a failure the file did not cause', () => {
    renderWithProviders(
      <StatusNotice upload={detail({ status: 'failed', error: { code: 'LLM_TIMEOUT', message: 'The AI service took too long to respond.' } })} />,
    );
    expect(screen.getByRole('button', { name: 'Retry extraction' })).toBeInTheDocument();
  });
});
