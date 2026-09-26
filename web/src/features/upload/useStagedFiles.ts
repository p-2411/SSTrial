import { useState } from 'react';
import { toast } from 'sonner';
import { MAX_FILES_PER_BATCH, validateFileMetadata, type SupportedMimeType } from '@label-extractor/shared';

/** A file picked but not yet uploaded. `problem` says why it can't be uploaded, if it can't. */
export interface StagedFile {
  id: string;
  file: File;
  mimeType: SupportedMimeType | null;
  problem: string | null;
}

function stage(file: File): StagedFile {
  const validation = validateFileMetadata({ name: file.name, type: file.type, size: file.size });
  return {
    id: crypto.randomUUID(),
    file,
    mimeType: validation.ok ? validation.mimeType : null,
    problem: validation.ok ? null : validation.message,
  };
}

/** The same file picked twice (dropped again, or chosen again) is only listed once. */
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * The files picked in the drop area, waiting for Upload. Each is checked as it's added, so one
 * that can't be uploaded says why straight away; on Upload it stays behind, so the reason isn't
 * lost, while the rest are handed over.
 */
export function useStagedFiles() {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const ready = staged.filter((s) => s.problem === null);

  /** Adds files not already listed, up to MAX_FILES_PER_BATCH; says so if some didn't fit. */
  const add = (files: File[]) => {
    const fresh = files.filter((file) => !staged.some((s) => sameFile(s.file, file)));
    const room = Math.max(0, MAX_FILES_PER_BATCH - staged.length);
    if (fresh.length > room) {
      const left = fresh.length - room;
      toast.warning(`You can add up to ${MAX_FILES_PER_BATCH} files at a time`, {
        description: `${left} ${left === 1 ? "file wasn't" : "files weren't"} added. Upload these first, then add the rest.`,
      });
    }
    if (room > 0) setStaged([...staged, ...fresh.slice(0, room).map(stage)]);
  };

  const remove = (id: string) => setStaged((current) => current.filter((s) => s.id !== id));

  /** Hands over the files that can be uploaded, and keeps only those that can't. */
  const takeReady = (): File[] => {
    setStaged((current) => current.filter((s) => s.problem !== null));
    return ready.map((s) => s.file);
  };

  return { staged, readyCount: ready.length, add, remove, takeReady };
}
