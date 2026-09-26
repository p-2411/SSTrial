import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveFile } from '../saveFile.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('saveFile', () => {
  it('saves the file under its name, keeping it available until the browser has started saving it', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL });
    let clicked: { download: string; inPage: boolean } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = { download: this.download, inPage: document.body.contains(this) }; // some browsers only download links in the page
    });

    saveFile(new Blob(['a,b\n']), 'uploads.csv');

    expect(clicked).toEqual({ download: 'uploads.csv', inPage: true });
    expect(document.querySelector('a')).toBeNull(); // tidied away afterwards
    expect(revokeObjectURL).not.toHaveBeenCalled(); // revoking at once can cancel it in Firefox and Safari
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});
