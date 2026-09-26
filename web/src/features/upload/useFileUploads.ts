import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { validateFileMetadata, type SupportedMimeType, type UploadSummary } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { refreshAfterChange, storeUpload } from '@/api/queries';
import { useWarnBeforeUnload } from '@/lib/useWarnBeforeUnload';
import { uploadFile } from './uploadFile';

/**
 * Tracks files the user has picked until the server has accepted them.
 *
 * Each file is validated instantly in the browser, then sent a few at a time (see uploadFile).
 * Once confirmed, the file shows up in the server's upload list and is removed from here. Files
 * that fail stay visible with the reason and a way to try again.
 */

type PendingUploadPhase =
  | 'rejected' // failed validation in the browser; never sent
  | 'waiting' // queued behind other files
  | 'uploading' // bytes on their way to storage
  | 'confirming' // telling the API the upload finished
  | 'failed'; // a request failed; can be retried

export interface PendingUpload {
  localId: string;
  file: File;
  /** The type validation settled on; null if the file was rejected. */
  mimeType: SupportedMimeType | null;
  phase: PendingUploadPhase;
  /** 0–1, while uploading. */
  progress: number;
  error: string | null;
}

/** Whether a file never made it: rejected here, or its upload failed. It waits to be tried again or dismissed. */
export function couldNotSend(upload: Pick<PendingUpload, 'phase'>): boolean {
  return upload.phase === 'rejected' || upload.phase === 'failed';
}

export interface FileUploadsOptions {
  /** The server already had this file, so it wasn't sent again; `upload` is the one it has. */
  onDuplicate?: (upload: UploadSummary, file: File) => void;
}

/** Uploading a few files at once is faster than one-by-one without saturating the connection. */
const MAX_PARALLEL_UPLOADS = 3;

type Action =
  | { type: 'added'; uploads: PendingUpload[] }
  | { type: 'updated'; localId: string; changes: Partial<PendingUpload> }
  | { type: 'removed'; localId: string };

function reducer(state: PendingUpload[], action: Action): PendingUpload[] {
  switch (action.type) {
    case 'added':
      return [...action.uploads, ...state];
    case 'updated':
      return state.map((upload) => (upload.localId === action.localId ? { ...upload, ...action.changes } : upload));
    case 'removed':
      return state.filter((upload) => upload.localId !== action.localId);
  }
}

export function useFileUploads({ onDuplicate }: FileUploadsOptions = {}) {
  const [pending, dispatch] = useReducer(reducer, []);
  const queryClient = useQueryClient();

  // The work queue lives in refs, not state: it's bookkeeping, not something to render.
  const waiting = useRef<PendingUpload[]>([]);
  const running = useRef(0);
  /** Uploads whose last attempt failed, by localId: the ones `retry` can send again. */
  const failed = useRef(new Map<string, PendingUpload>());

  // Read at the moment a duplicate comes back, so the caller needn't memoise it and the functions
  // returned below stay stable for memoised children.
  const onDuplicateRef = useRef(onDuplicate);
  useEffect(() => {
    onDuplicateRef.current = onDuplicate;
  });

  const update = useCallback(
    (localId: string, changes: Partial<PendingUpload>) => dispatch({ type: 'updated', localId, changes }),
    [],
  );

  const send = useCallback(
    async (upload: PendingUpload) => {
      const { localId, file } = upload;
      try {
        update(localId, { phase: 'uploading', progress: 0, error: null });

        // Progress events can fire dozens of times a second, and each state update re-renders the
        // app shell, so only report whole-percent changes: at most 100 updates per file.
        let reportedPercent = -1;
        const result = await uploadFile(file, {
          onProgress: (progress) => {
            const percent = Math.floor(progress * 100);
            if (percent === reportedPercent) return;
            reportedPercent = percent;
            update(localId, { progress });
          },
          onConfirming: () => update(localId, { phase: 'confirming', progress: 1 }),
        });

        if (result.kind === 'duplicate') {
          dispatch({ type: 'removed', localId });
          onDuplicateRef.current?.(result.upload, file);
          return;
        }

        // Hand over to the server-side list: cache the detail, wait for the list to include this
        // upload, then drop the local row, so it moves across without a flicker.
        storeUpload(queryClient, result.upload);
        await refreshAfterChange(queryClient);
        dispatch({ type: 'removed', localId });
      } catch (error) {
        failed.current.set(localId, upload);
        update(localId, { phase: 'failed', error: errorMessage(error) });
      }
    },
    [queryClient, update],
  );

  /** Starts waiting uploads until MAX_PARALLEL_UPLOADS are in flight. */
  const pump = useCallback(() => {
    while (running.current < MAX_PARALLEL_UPLOADS && waiting.current.length > 0) {
      const next = waiting.current.shift()!;
      running.current += 1;
      void send(next).finally(() => {
        running.current -= 1;
        pump();
      });
    }
  }, [send]);

  /** Adds files picked or dropped by the user. Invalid ones are rejected immediately. */
  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const added: PendingUpload[] = [];
      for (const file of files) {
        const validation = validateFileMetadata({ name: file.name, type: file.type, size: file.size });
        const upload: PendingUpload = {
          localId: crypto.randomUUID(),
          file,
          mimeType: validation.ok ? validation.mimeType : null,
          phase: validation.ok ? 'waiting' : 'rejected',
          progress: 0,
          error: validation.ok ? null : validation.message,
        };
        added.push(upload);
        if (validation.ok) waiting.current.push(upload);
      }
      dispatch({ type: 'added', uploads: added });
      pump();
    },
    [pump],
  );

  /** Tries a failed upload again from the start (a new signed URL, a fresh upload). */
  const retry = useCallback(
    (localId: string) => {
      const upload = failed.current.get(localId);
      if (!upload) return;
      failed.current.delete(localId);
      update(localId, { phase: 'waiting', progress: 0, error: null });
      waiting.current.push(upload);
      pump();
    },
    [pump, update],
  );

  /** Removes a rejected or failed file from the list. */
  const dismiss = useCallback((localId: string) => {
    failed.current.delete(localId);
    dispatch({ type: 'removed', localId });
  }, []);

  /** Whether any file is still on its way. Leaving the page (or signing out) now would silently lose it. */
  const busy = pending.some((u) => u.phase === 'waiting' || u.phase === 'uploading' || u.phase === 'confirming');
  useWarnBeforeUnload(busy);

  return { pending, busy, addFiles, retry, dismiss };
}

export type FileUploads = ReturnType<typeof useFileUploads>;
