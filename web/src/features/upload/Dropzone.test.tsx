import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dropzone } from './Dropzone.tsx';

const png = (name = 'label.png') => new File([new Uint8Array(2048)], name, { type: 'image/png' });
const text = () => new File(['not a label'], 'notes.txt', { type: 'text/plain' });

function setup() {
  const onSubmit = vi.fn<(files: File[]) => void>();
  render(<Dropzone onSubmit={onSubmit} />);
  // applyAccept off: the picker's filter is a hint, and people can still drop anything.
  const user = userEvent.setup({ applyAccept: false });
  const pick = (...files: File[]) => user.upload(screen.getByTestId('file-input'), files);
  const cards = () => within(screen.getByRole('list', { name: 'Files to upload' })).getAllByRole('listitem');
  return { onSubmit, user, pick, cards };
}

describe('Dropzone', () => {
  it('invites a drop or a pick while empty', () => {
    setup();
    expect(screen.getByText('Drop label photos or PDFs here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('lists picked files inside the drop area, and sends nothing until Submit', async () => {
    const { onSubmit, pick, cards } = setup();

    await pick(png('front.png'), png('back.png'));

    expect(cards().map((card) => card.textContent)).toEqual([
      expect.stringContaining('front.png'),
      expect.stringContaining('back.png'),
    ]);
    expect(cards()[0]).toHaveTextContent('PNG, 2 KB');
    // The invitation gives way to the list, with the actions underneath.
    expect(screen.queryByText('Drop label photos or PDFs here')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose files' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add more files' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uploads them on Submit, and empties the list', async () => {
    const { onSubmit, user, pick } = setup();
    const files = [png('front.png'), png('back.png')];
    await pick(...files);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).toHaveBeenCalledWith(files);
    expect(screen.queryByRole('list', { name: 'Files to upload' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
  });

  it('says why a file can’t be uploaded, and keeps it back on Submit', async () => {
    const { onSubmit, user, pick, cards } = setup();
    const good = png();
    await pick(good, text());

    expect(cards()[1]).toHaveTextContent('".txt" files aren\'t supported.');

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).toHaveBeenCalledWith([good]);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent('notes.txt');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled(); // nothing left that can go
  });

  it('removes a file, and goes back to the invitation once none are left', async () => {
    const { user, pick, cards } = setup();
    await pick(png('front.png'), png('back.png'));

    await user.click(screen.getByRole('button', { name: 'Remove front.png' }));
    expect(cards()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Remove back.png' }));
    expect(screen.getByText('Drop label photos or PDFs here')).toBeInTheDocument();
  });

  it('lists a file only once, however often it is added, and takes more by drop', async () => {
    const { pick, cards } = setup();
    const file = png();
    await pick(file);
    await pick(file);
    expect(cards()).toHaveLength(1);

    fireEvent.drop(screen.getByRole('list', { name: 'Files to upload' }), {
      dataTransfer: { files: [png('dropped.png')], types: ['Files'] },
    });
    expect(cards()).toHaveLength(2);
  });
});
