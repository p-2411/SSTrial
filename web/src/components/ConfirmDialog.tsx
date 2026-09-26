import { useRef, type ReactNode } from 'react';
import { errorMessage } from '@/api/client';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** The request that confirming sends: a React Query mutation, or anything shaped like one. */
interface ConfirmedRequest {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
}

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  /** The confirm button's label: the action's own name ("Delete"), never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `destructive` for what can't be undone. */
  variant?: 'default' | 'destructive';
  request: ConfirmedRequest;
  /** Says why the request failed, when the server's message isn't the best way to put it. */
  describeError?: (error: unknown) => string;
  /** When confirming can no longer help (the thing changed meanwhile, say). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  /** Cancelled or dismissed. Never called while the request is in flight. */
  onClose: () => void;
}

/**
 * Asks before an action that's hard to take back, and sees it through: it stays open while the
 * request is in flight (no walking away mid-request, by Esc or a click outside), and if the request
 * fails it stays open and says why. Closing it clears that error, so a refusal doesn't greet the
 * next attempt. The caller closes it on success. Focus goes back to whatever opened it.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  request,
  describeError = errorMessage,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  // The button or menu item that opened it. Controlled dialogs have no trigger of their own for
  // focus to go back to, so it would otherwise be lost to the page.
  const opener = useRef<HTMLElement | null>(null);

  const onOpenChange = (next: boolean) => {
    if (next || request.isPending) return;
    request.reset();
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = opener.current;
          opener.current = null;
          // Gone with what was deleted, or in a panel that's closing: leave focus to the page.
          if (!target?.isConnected || target.closest('[inert]')) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {request.isError && (
          <p role="alert" className="text-danger">
            {describeError(request.error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={request.isPending}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <Button variant={variant} loading={request.isPending} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
