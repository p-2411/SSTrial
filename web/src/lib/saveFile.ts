/**
 * How long a saved file's object URL outlives the click. Revoking it straight away can cancel the
 * download in Firefox and Safari; a minute is ample for the browser to have taken the file.
 */
const REVOKE_AFTER_MS = 60_000;

/** Hands `blob` to the browser to save as a download named `fileName`. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  // In the page while clicked: some browsers ignore clicks on detached links.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
