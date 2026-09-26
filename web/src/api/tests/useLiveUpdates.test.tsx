import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createTestQueryClient, Providers } from '@/test/render';
import { isLiveConnected } from '../liveConnection.ts';
import { logKeys, uploadKeys } from '../queries.ts';
import { useLiveUpdates } from '../useLiveUpdates.ts';

/** Stands in for the authorized event stream so the test can play server events. */
const { FakeEventSource } = vi.hoisted(() => {
  class FakeEventSource {
    static last: FakeEventSource;
    readonly listeners = new Map<string, (event: MessageEvent) => void>();
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    readonly url: string;
    constructor(url: string) {
      this.url = url;
      FakeEventSource.last = this;
    }
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      this.listeners.set(type, listener);
    }
    close() {
      this.closed = true;
    }
    emit(type: string, data: unknown) {
      this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
  return { FakeEventSource };
});
vi.mock('../eventStream.ts', () => ({ AuthorizedEventSource: FakeEventSource }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function setup() {
  const client = createTestQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <Providers client={client}>{children}</Providers>;
  const hook = renderHook(() => useLiveUpdates(), { wrapper });
  return { invalidate, hook, source: FakeEventSource.last };
}

const invalidatedKeys = (spy: ReturnType<typeof setup>['invalidate']) => spy.mock.calls.map(([filters]) => filters?.queryKey);

describe('useLiveUpdates', () => {
  it('connects to the event stream, and stops polling while connected', () => {
    const { source } = setup();
    expect(source.url).toBe('/api/events');

    act(() => source.onopen?.());
    expect(isLiveConnected()).toBe(true);
  });

  it('refreshes the lists and the changed upload, batching a burst into one refresh', () => {
    const { source, invalidate } = setup();
    act(() => source.onopen?.());
    invalidate.mockClear();

    act(() => {
      source.emit('upload', { type: 'upload', id: 'a', status: 'completed' });
      source.emit('upload', { type: 'upload', id: 'b', status: 'failed' });
    });
    expect(invalidate).not.toHaveBeenCalled(); // waits for the burst to finish
    act(() => vi.advanceTimersByTime(300));

    expect(invalidatedKeys(invalidate)).toEqual([uploadKeys.lists(), uploadKeys.detail('a'), uploadKeys.detail('b')]);
  });

  it('refreshes only the activity log when it has new events', () => {
    const { source, invalidate } = setup();
    act(() => source.onopen?.());
    invalidate.mockClear();

    act(() => {
      source.emit('log', { type: 'log' });
      source.emit('log', { type: 'log' });
    });
    act(() => vi.advanceTimersByTime(300));

    expect(invalidatedKeys(invalidate)).toEqual([logKeys.all]);
  });

  it('refetches everything on resync, and falls back to polling when the stream drops', () => {
    const { source, invalidate } = setup();
    act(() => source.onopen?.());
    invalidate.mockClear();

    act(() => source.emit('resync', { type: 'resync' }));
    expect(invalidatedKeys(invalidate)).toEqual([uploadKeys.all, logKeys.all]);

    act(() => source.onerror?.());
    expect(isLiveConnected()).toBe(false);
  });

  it('closes the stream when the app unmounts', () => {
    const { source, hook } = setup();
    hook.unmount();
    expect(source.closed).toBe(true);
  });
});
