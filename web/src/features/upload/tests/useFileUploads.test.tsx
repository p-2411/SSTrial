import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as api from '@/api/uploads';
import { detail, summary } from '@/test/fixtures';
import { createTestQueryClient, Providers } from '@/test/render';
import { useFileUploads } from '../useFileUploads';

vi.mock('@/api/uploads');
const mocked = vi.mocked(api);

function renderUploads(onDuplicate = vi.fn()) {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <Providers client={client}>{children}</Providers>;
  return renderHook(() => useFileUploads({ onDuplicate }), { wrapper });
}

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'label.png', { type: 'image/png' });

beforeEach(() => {
  vi.resetAllMocks();
  mocked.createUpload.mockResolvedValue({ kind: 'created', upload: summary({ status: 'uploading' }), uploadUrl: 'https://storage/signed' });
  mocked.putFileToStorage.mockResolvedValue();
  mocked.completeUpload.mockResolvedValue(detail({ status: 'queued' }));
  mocked.listUploads.mockResolvedValue({ uploads: [], nextCursor: null });
});

describe('useFileUploads', () => {
  it('rejects unsupported files in the browser without calling the API', () => {
    const { result } = renderUploads();

    act(() => result.current.addFiles([new File(['hi'], 'notes.txt', { type: 'text/plain' })]));

    expect(result.current.pending).toMatchObject([
      { phase: 'rejected', error: expect.stringContaining('".txt" files aren\'t supported') },
    ]);
    expect(mocked.createUpload).not.toHaveBeenCalled();
  });

  it('uploads a valid file, confirms it, then hands it over to the server list', async () => {
    const { result } = renderUploads();

    act(() => result.current.addFiles([png()]));

    await waitFor(() => expect(result.current.pending).toEqual([]));
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
    await waitFor(() => expect(result.current.pending[0]?.phase).toBe('failed'));
    expect(result.current.pending[0]?.error).toMatch(/interrupted/);

    act(() => result.current.retry(result.current.pending[0]!.localId));
    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(mocked.createUpload).toHaveBeenCalledTimes(2);
  });

  it('uploads at most three files at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mocked.putFileToStorage.mockImplementation(() => gate);
    const { result } = renderUploads();

    act(() => result.current.addFiles([png(), png(), png(), png(), png()]));

    await waitFor(() => expect(mocked.putFileToStorage).toHaveBeenCalledTimes(3));
    expect(result.current.pending.filter((u) => u.phase === 'waiting')).toHaveLength(2);
    await act(async () => release());
    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(mocked.putFileToStorage).toHaveBeenCalledTimes(5);
  });

  it('is busy while a file is on its way, but not for a file that failed', async () => {
    let fail!: (error: Error) => void;
    mocked.putFileToStorage.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const { result } = renderUploads();
    expect(result.current.busy).toBe(false);

    act(() => result.current.addFiles([png()]));
    await waitFor(() => expect(mocked.putFileToStorage).toHaveBeenCalled());
    expect(result.current.busy).toBe(true);

    await act(async () => fail(new Error('The upload was interrupted.')));
    await waitFor(() => expect(result.current.pending[0]?.phase).toBe('failed'));
    expect(result.current.busy).toBe(false);
  });

  it('skips a file the server already has, and hands the existing upload to the caller', async () => {
    const existing = summary({ id: 'existing', status: 'completed' });
    mocked.createUpload.mockResolvedValueOnce({ kind: 'duplicate', upload: existing });
    const onDuplicate = vi.fn();
    const { result } = renderUploads(onDuplicate);

    act(() => result.current.addFiles([png()]));

    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(mocked.putFileToStorage).not.toHaveBeenCalled();
    expect(onDuplicate).toHaveBeenCalledWith(existing, expect.objectContaining({ name: 'label.png' }));
  });
});
