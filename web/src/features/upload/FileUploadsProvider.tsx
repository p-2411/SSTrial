import { createContext, use, type ReactNode } from 'react';
import { useFileUploads, type FileUploads, type FileUploadsOptions } from './useFileUploads';

const FileUploadsContext = createContext<FileUploads | null>(null);

/**
 * Holds the files being sent from this browser. It sits in the app shell, above the pages, so
 * uploads carry on while you look at another page.
 */
export function FileUploadsProvider({ children, ...options }: FileUploadsOptions & { children: ReactNode }) {
  const fileUploads = useFileUploads(options);
  return <FileUploadsContext value={fileUploads}>{children}</FileUploadsContext>;
}

/** The files being sent, and ways to add, retry and dismiss them. Must be inside FileUploadsProvider. */
export function useFileUploadsContext(): FileUploads {
  const fileUploads = use(FileUploadsContext);
  if (!fileUploads) throw new Error('useFileUploadsContext must be used inside <FileUploadsProvider>.');
  return fileUploads;
}
