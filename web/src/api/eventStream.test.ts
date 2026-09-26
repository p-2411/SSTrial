import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetch } from '@/test/fetch';
import { AuthorizedEventSource, EventStreamParser } from './eventStream.ts';

describe('EventStreamParser', () => {
  it('reads named events, across chunk boundaries, skipping comments', () => {
    const parser = new EventStreamParser();
    expect(parser.push('retry: 3000\n\n: keep-alive\n\nevent: upl')).toEqual([]);
    expect(parser.push('oad\ndata: {"id":"1"}\n\nevent: log\ndata: {}\n\n')).toEqual([
      { type: 'upload', data: '{"id":"1"}' },
      { type: 'log', data: '{}' },
    ]);
    expect(parser.retryMs).toBe(3000);
  });
});

describe('AuthorizedEventSource', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the auth header, and waits before reconnecting when refused', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const onerror = vi.fn();

    const source = new AuthorizedEventSource('/api/events', async () => ({ authorization: 'Bearer t' }));
    source.onerror = onerror;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ authorization: 'Bearer t' });
    expect(onerror).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_900);
    expect(fetchMock).toHaveBeenCalledTimes(1); // not a tight loop
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    source.close();
  });

  it('reconnects with a fresh token when the server ends the stream (as it does when the token expires)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('retry: 1000\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const tokens = ['first', 'refreshed'];

    const source = new AuthorizedEventSource('/api/events', async () => ({ authorization: `Bearer ${tokens.shift()}` }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toEqual({ authorization: 'Bearer refreshed' });
    source.close();
  });

  it('leaves no listener behind on the stream’s signal between retries', async () => {
    vi.useFakeTimers();
    stubFetch(() => new Response('', { status: 503 }));
    const added = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const removed = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    const abortListeners = () =>
      added.mock.calls.filter(([type]) => type === 'abort').length - removed.mock.calls.filter(([type]) => type === 'abort').length;

    const source = new AuthorizedEventSource('/api/events', async () => ({}));
    await vi.advanceTimersByTimeAsync(10_000); // several refusals, each followed by a wait
    expect(added.mock.calls.filter(([type]) => type === 'abort').length).toBeGreaterThan(2);
    expect(abortListeners()).toBeLessThanOrEqual(1); // just the wait in progress
    source.close();
    vi.restoreAllMocks();
  });

  it('delivers events to their listeners once connected', async () => {
    const body = 'retry: 3000\n\nevent: upload\ndata: {"id":"9"}\n\n';
    stubFetch(() => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const received: string[] = [];
    const opened = vi.fn();

    const source = new AuthorizedEventSource('/api/events', async () => ({}));
    source.onopen = opened;
    source.addEventListener('upload', (event) => received.push(event.data));
    await vi.waitFor(() => expect(received).toEqual(['{"id":"9"}']));
    expect(opened).toHaveBeenCalled();
    source.close();
  });
});
