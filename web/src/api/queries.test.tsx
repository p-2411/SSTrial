import type { ReactNode } from 'react';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListUploadsResponse } from '@label-extractor/shared';
import { detail, summary } from '@/test/fixtures';
import { jsonResponse, stubFetch } from '@/test/fetch';
import { createTestQueryClient, Providers } from '@/test/render';
import { logKeys, refreshUploadLists, uploadKeys, useDeleteUpload, useEditResult, useRetryUpload, useRevertUpload } from './queries';

/** A list query with an observer (so refreshes refetch it), whose fetches the test answers by hand. */
function watchedList(client: QueryClient) {
  const fetches: Array<(page: ListUploadsResponse) => void> = [];
  const observer = new InfiniteQueryObserver(client, {
    queryKey: uploadKeys.list('upload'), // where a handed-over upload arrives
    queryFn: () => new Promise<ListUploadsResponse>((resolve) => fetches.push(resolve)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => undefined,
  });
  const stop = observer.subscribe(() => {});
  return { fetches, observer, stop };
}

let stop = () => {};
afterEach(() => stop());

describe('refreshUploadLists', () => {
  it('resolves only once the lists show fresh data, even when another refresh cancels its own', async () => {
    const client = new QueryClient();
    const list = watchedList(client);
    stop = list.stop;
    list.fetches[0]!({ uploads: [], nextCursor: null }); // the list as first loaded
    await vi.waitFor(() => expect(list.observer.getCurrentResult().isSuccess).toBe(true));

    let resolved = false;
    const refreshing = refreshUploadLists(client).then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(list.fetches).toHaveLength(2));
    // A live update arrives meanwhile and refreshes the lists again, cancelling the refetch above.
    void client.invalidateQueries({ queryKey: uploadKeys.lists() });
    await vi.waitFor(() => expect(list.fetches).toHaveLength(3));

    await new Promise((settle) => setTimeout(settle, 20));
    expect(resolved).toBe(false); // the list still shows the old data: nothing to hand over to yet

    list.fetches[2]!({ uploads: [summary({ id: 'new' })], nextCursor: null });
    await refreshing;
    expect(list.observer.getCurrentResult().data?.pages[0]?.uploads.map((upload) => upload.id)).toEqual(['new']);
  });
});

describe('the refresh rule every change follows', () => {
  function setup() {
    stubFetch(({ method }) => (method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse({ upload: detail({ id: 'u1' }) })));
    const client = createTestQueryClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <Providers client={client}>{children}</Providers>;
    const refreshed = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey);
    return { client, wrapper, refreshed };
  }

  /** Each change, as a hook that hands back a function making it. */
  const changes: Array<[string, () => () => Promise<unknown>]> = [
    ['an edit', () => useEditResult('u1').mutateAsync.bind(null, { revision: 0, checked: ['brand'] })],
    ['a retry', () => useRetryUpload().mutateAsync.bind(null, 'u1')],
    ['a revert', () => useRevertUpload('u1').mutateAsync.bind(null, { revision: 0, versionId: '1' })],
  ];

  it.each(changes)('%s caches the upload, and refreshes the lists and the activity', async (_what, useChange) => {
    const { client, wrapper, refreshed } = setup();
    const { result } = renderHook(useChange, { wrapper });

    await result.current();

    expect(client.getQueryData(uploadKeys.detail('u1'))).toMatchObject({ id: 'u1' });
    expect(refreshed()).toEqual(expect.arrayContaining([uploadKeys.lists(), logKeys.all]));
  });

  it('a delete drops the upload, and refreshes the lists and the activity', async () => {
    const { client, wrapper, refreshed } = setup();
    client.setQueryData(uploadKeys.detail('u1'), detail({ id: 'u1' }));
    const { result } = renderHook(() => useDeleteUpload(), { wrapper });

    await result.current.mutateAsync('u1');

    expect(client.getQueryData(uploadKeys.detail('u1'))).toBeUndefined();
    expect(refreshed()).toEqual(expect.arrayContaining([uploadKeys.lists(), logKeys.all]));
  });
});
