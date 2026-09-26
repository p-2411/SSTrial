import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { detail } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { SourceDocumentCard } from '../SourceDocumentCard';

describe('SourceDocumentCard', () => {
  it('holds the image’s place with a spinner until it has loaded', () => {
    renderWithProviders(
      <SourceDocumentCard upload={detail({ mimeType: 'image/png', fileName: 'label.png', fileUrl: 'https://storage.test/label.png' })} />,
    );
    // Hidden images aren't in the accessibility tree, so it's found by its alt text.
    const image = screen.getByAltText('Original label: label.png');
    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeVisible();
    expect(image).not.toBeVisible();

    fireEvent.load(image);

    expect(screen.queryByRole('status', { name: 'Loading preview' })).not.toBeInTheDocument();
    expect(image).toBeVisible();
  });

  it('says so when the image can’t be shown', () => {
    renderWithProviders(
      <SourceDocumentCard upload={detail({ mimeType: 'image/png', fileName: 'label.png', fileUrl: 'https://storage.test/label.png' })} />,
    );
    fireEvent.error(screen.getByAltText('Original label: label.png'));
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
  });
});
