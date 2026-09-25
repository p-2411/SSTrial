import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it('delivers events to their listeners once connected', async () => {
    const body = 'retry: 3000\n\nevent: upload\ndata: {"id":"9"}\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })));
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
