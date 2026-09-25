import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { validateFileMetadata } from '@label-extractor/shared';
import { errorMessage } from '../../api/client.ts';
import { uploadKeys } from '../../api/queries.ts';
import { completeUpload, createUpload, putFileToStorage } from '../../api/uploads.ts';
import { sha256Hex } from '../../lib/hashFile.ts';

/**
 * Tracks files the user has picked until the server has accepted them.
 *
 * Each file goes: validate (instantly, in the browser) → ask the API for a signed URL → PUT the
 * bytes to storage (with progress) → confirm with the API. Once confirmed, the file shows up in
 * the server's upload list and is removed from here. Files that fail stay visible with the
 * reason and a way to try again.
 */

export type PendingUploadPhase =
  | 'rejected' // failed validation in the browser; never sent
  | 'waiting' // queued behind other files
  | 'uploading' // bytes on their way to storage
  | 'confirming' // telling the API the upload finished
  | 'failed'; // a request failed; can be retried

export interface PendingUpload {
  localId: string;
  file: File;
  phase: PendingUploadPhase;
  /** 0–1, while uploading. */
  progress: number;
  error: string | null;
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

export function useFileUploads() {
  const [uploads, dispatch] = useReducer(reducer, []);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // The work queue lives in refs, not state: it's bookkeeping, not something to render.
  const waiting = useRef<PendingUpload[]>([]);
  const running = useRef(0);

  const update = useCallback(
    (localId: string, changes: Partial<PendingUpload>) => dispatch({ type: 'updated', localId, changes }),
    [],
  );

  const send = useCallback(
    async ({ localId, file }: PendingUpload) => {
      try {
        update(localId, { phase: 'uploading', progress: 0, error: null });
        const created = await createUpload({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          // Lets the API recognise a file it already has, so it isn't uploaded or extracted twice.
          sha256: await sha256Hex(file),
        });

        if (created.kind === 'duplicate') {
          dispatch({ type: 'removed', localId });
          const existingId = created.upload.id;
          toast(`${file.name} was already uploaded`, {
            description: 'Showing the existing upload instead of processing it again.',
            action: { label: 'View', onClick: () => void navigate(`/uploads/${existingId}`) },
          });
          return;
        }
        const { upload, uploadUrl } = created;

        // Use the API's normalised type: the browser's `file.type` can be empty or "image/jpg".
        await putFileToStorage(uploadUrl, file, upload.mimeType, (progress) => update(localId, { progress }));

        update(localId, { phase: 'confirming', progress: 1 });
        const confirmed = await completeUpload(upload.id);

        // Hand over to the server-side list: cache the detail, wait for the list to include this
        // upload, then drop the local row, so it moves across without a flicker.
        queryClient.setQueryData(uploadKeys.detail(confirmed.id), confirmed);
        await queryClient.invalidateQueries({ queryKey: uploadKeys.list() });
        dispatch({ type: 'removed', localId });
      } catch (error) {
        update(localId, { phase: 'failed', error: errorMessage(error) });
      }
    },
    [navigate, queryClient, update],
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
    (upload: PendingUpload) => {
      if (upload.phase !== 'failed') return;
      update(upload.localId, { phase: 'waiting', progress: 0, error: null });
      waiting.current.push(upload);
      pump();
    },
    [pump, update],
  );

  const dismiss = useCallback((localId: string) => dispatch({ type: 'removed', localId }), []);

  // Leaving the page mid-upload would silently lose files, so ask first.
  const inProgress = uploads.some((u) => u.phase === 'waiting' || u.phase === 'uploading' || u.phase === 'confirming');
  useEffect(() => {
    if (!inProgress) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [inProgress]);

  return { uploads, addFiles, retry, dismiss };
}
