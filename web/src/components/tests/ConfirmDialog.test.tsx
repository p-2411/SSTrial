import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

/** A button that opens the dialog, over a request in whatever state the test gives it. */
function Harness({ request }: { request: { isPending: boolean; isError: boolean; error: unknown; reset: () => void } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Remove it</button>
      <ConfirmDialog
        open={open}
        title="Remove it?"
        description="It can't be undone."
        confirmLabel="Remove"
        variant="destructive"
        request={request}
        onConfirm={() => {}}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const idle = () => ({ isPending: false, isError: false, error: null, reset: vi.fn() });

describe('ConfirmDialog', () => {
  it('can be cancelled, and gives focus back to what opened it', async () => {
    const request = idle();
    render(<Harness request={request} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(request.reset).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove it' })).toHaveFocus();
  });

  it("can't be walked away from while its request is in flight", async () => {
    render(<Harness request={{ ...idle(), isPending: true }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('alertdialog', { name: 'Remove it?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('says why the request failed, and stays open', async () => {
    render(<Harness request={{ ...idle(), isError: true, error: new Error('Only an admin can remove it.') }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Only an admin can remove it.');
  });
});
