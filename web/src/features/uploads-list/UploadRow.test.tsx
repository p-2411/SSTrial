import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UploadSummary } from '@label-extractor/shared';
import { summary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { UploadRow } from './UploadRow.tsx';

/** Renders the row, and returns it: a link to the upload's detail. */
function renderRow(upload: UploadSummary) {
  renderWithProviders(
    <ul>
      <UploadRow upload={upload} now={Date.now()} />
    </ul>,
  );
  return screen.getByRole('link');
}

describe('UploadRow', () => {
  it('leads with the product name, with type and size beside it, once the label is read', () => {
    const row = renderRow(summary({ fileName: 'IMG_0042.png', productName: 'Maple Pecan Crunch', sizeBytes: 50_000 }));

    // Read top to bottom: the product, its file's type and size, then the file's name.
    expect(row).toHaveTextContent(/^Maple Pecan CrunchPNG, 48\.8 KBIMG_0042\.png/);
  });

  it('leads with the file name, and says why, when there is no product yet', () => {
    const row = renderRow(
      summary({
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        status: 'failed',
        productName: null,
        error: { code: 'NO_LABEL_DATA', message: "Couldn't find any product label information in this file." },
      }),
    );

    expect(row).toHaveTextContent(/^scan\.pdfPDF, 2 KBCouldn't find any product label information in this file\./);
  });

  it('says so when a read label had no product name', () => {
    const row = renderRow(summary({ fileName: 'back-of-pack.png', productName: null, sizeBytes: 1024 }));

    expect(row).toHaveTextContent(/^back-of-pack\.pngPNG, 1 KBNo product name on label/);
  });

  it.each([72, 58])('invites a check of a completed upload with a confidence of %s, in place of "Completed"', (confidence) => {
    renderRow(summary({ confidence }));
    // As read aloud: what it is, then the invitation.
    expect(screen.getByText('Check')).toHaveTextContent(`Completed, confidence ${confidence}%: Check (${confidence}%)`);
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it.each([92, null])('is just "Completed" with a confidence of %s (confident, or nothing to flag)', (confidence) => {
    renderRow(summary({ confidence }));
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
