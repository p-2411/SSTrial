import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UploadSummary } from '@label-extractor/shared';
import { renderWithProviders } from '@/test/render';
import { summary } from '@/test/fixtures';
import { UploadRow } from './UploadRow.tsx';

function renderRow(upload: UploadSummary) {
  renderWithProviders(
    <ul>
      <UploadRow upload={upload} now={Date.now()} />
    </ul>,
  );
  // The row's two lines, top to bottom: [name, type and size] then the second line.
  const [first, second] = screen.getByRole('link').querySelectorAll(':scope > div:nth-child(2) > p');
  return { first: first?.textContent, second: second?.textContent };
}

describe('UploadRow', () => {
  it('leads with the product name, with type and size beside it, once the label is read', () => {
    const lines = renderRow(summary({ fileName: 'IMG_0042.png', productName: 'Maple Pecan Crunch', sizeBytes: 50_000 }));

    expect(lines).toEqual({ first: 'Maple Pecan CrunchPNG, 48.8 KB', second: 'IMG_0042.png' });
  });

  it('leads with the file name, and says why, when there is no product yet', () => {
    const lines = renderRow(
      summary({
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        status: 'failed',
        productName: null,
        error: { code: 'NO_LABEL_DATA', message: "Couldn't find any product label information in this file." },
      }),
    );

    expect(lines).toEqual({
      first: 'scan.pdfPDF, 2 KB',
      second: "Couldn't find any product label information in this file.",
    });
  });

  it('says so when a read label had no product name', () => {
    const lines = renderRow(summary({ fileName: 'back-of-pack.png', productName: null, sizeBytes: 1024 }));

    expect(lines).toEqual({ first: 'back-of-pack.pngPNG, 1 KB', second: 'No product name on label' });
  });

  it('says how confident the extraction is, flagging a score that needs checking', () => {
    renderRow(summary({ confidence: 58 }));
    const score = screen.getByText('58%');
    expect(score).toHaveClass('text-danger');
    expect(score).toHaveTextContent('Confidence 58%, low'); // what a screen reader hears
  });

  it('keeps a confident score quiet', () => {
    renderRow(summary({ confidence: 92 }));
    expect(screen.getByText('92%')).toHaveClass('text-muted-foreground');
  });

  it('shows no confidence when there is none to show (never scored, or every field reviewed)', () => {
    renderRow(summary({ confidence: null }));
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
  });
});
