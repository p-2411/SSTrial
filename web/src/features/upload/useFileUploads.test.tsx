import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createTestQueryClient, Providers } from '../../test/render.tsx';
import { summary } from '../../test/fixtures.ts';
import { toast } from 'sonner';
import * as api from '../../api/uploads.ts';
import { useFileUploads } from './useFileUploads.ts';

vi.mock('../../api/uploads.ts');
vi.mock('sonner', () => ({ toast: vi.fn() }));
const mocked = vi.mocked(api);

function renderUploads() {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <Providers client={client}>{children}</Providers>;
  return renderHook(() => useFileUploads(), { wrapper });
}

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'label.png', { type: 'image/png' });

beforeEach(() => {
  vi.resetAllMocks();
  mocked.createUpload.mockResolvedValue({ kind: 'created', upload: summary({ status: 'uploading' }), uploadUrl: 'https://storage/signed' });
  mocked.putFileToStorage.mockResolvedValue();
  mocked.completeUpload.mockResolvedValue({ ...summary({ status: 'queued' }), result: null, fileUrl: null });
  mocked.listUploads.mockResolvedValue([]);
});

describe('useFileUploads', () => {
  it('rejects unsupported files in the browser without calling the API', () => {
    const { result } = renderUploads();

    act(() => result.current.addFiles([new File(['hi'], 'notes.txt', { type: 'text/plain' })]));

    expect(result.current.uploads).toMatchObject([
      { phase: 'rejected', error: expect.stringContaining('".txt" files aren\'t supported') },
    ]);
    expect(mocked.createUpload).not.toHaveBeenCalled();
  });

  it('uploads a valid file, confirms it, then hands it over to the server list', async () => {
    const { result } = renderUploads();

    act(() => result.current.addFiles([png()]));

    await waitFor(() => expect(result.current.uploads).toEqual([]));
    expect(mocked.createUpload).toHaveBeenCalledWith({
      fileName: 'label.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      sha256: '0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543', // SHA-256 of the 4 bytes
    });
    expect(mocked.putFileToStorage).toHaveBeenCalledWith('https://storage/signed', expect.any(File), 'image/png', expect.any(Function));
    expect(mocked.completeUpload).toHaveBeenCalledWith(summary().id);
  });

  it('keeps a failed upload visible with the reason, and can retry it', async () => {
    mocked.putFileToStorage.mockRejectedValueOnce(new Error('The upload was interrupted. Check your connection and try again.'));
    const { result } = renderUploads();

    act(() => result.current.addFiles([png()]));
    await waitFor(() => expect(result.current.uploads[0]?.phase).toBe('failed'));
    expect(result.current.uploads[0]?.error).toMatch(/interrupted/);

    act(() => result.current.retry(result.current.uploads[0]!));
    await waitFor(() => expect(result.current.uploads).toEqual([]));
    expect(mocked.createUpload).toHaveBeenCalledTimes(2);
  });

  it('uploads at most three files at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mocked.putFileToStorage.mockImplementation(() => gate);
    const { result } = renderUploads();

    act(() => result.current.addFiles([png(), png(), png(), png(), png()]));

    await waitFor(() => expect(mocked.putFileToStorage).toHaveBeenCalledTimes(3));
    expect(result.current.uploads.filter((u) => u.phase === 'waiting')).toHaveLength(2);
    await act(async () => release());
    await waitFor(() => expect(result.current.uploads).toEqual([]));
    expect(mocked.putFileToStorage).toHaveBeenCalledTimes(5);
  });

  it('skips a file the server already has, and points to the existing upload', async () => {
    mocked.createUpload.mockResolvedValueOnce({ kind: 'duplicate', upload: summary({ id: 'existing', status: 'completed' }) });
    const { result } = renderUploads();

    act(() => result.current.addFiles([png()]));

    await waitFor(() => expect(result.current.uploads).toEqual([]));
    expect(mocked.putFileToStorage).not.toHaveBeenCalled();
    expect(vi.mocked(toast)).toHaveBeenCalledWith('label.png was already uploaded', expect.objectContaining({ action: expect.anything() }));
  });
});
