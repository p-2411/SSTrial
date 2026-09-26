import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListUploadsResponse } from '@label-extractor/shared';
import { summary } from '@/test/fixtures';
import { refreshUploadLists, uploadKeys } from './queries';

/** A list query with an observer (so refreshes refetch it), whose fetches the test answers by hand. */
function watchedList(client: QueryClient) {
  const fetches: Array<(page: ListUploadsResponse) => void> = [];
  const observer = new InfiniteQueryObserver(client, {
    queryKey: uploadKeys.list('all'),
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
