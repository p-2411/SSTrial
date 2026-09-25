/**
 * Server-sent events with our Authorization header. The browser's EventSource can't send headers,
 * and a token in the URL would end up in server and proxy logs, so this reads the stream with
 * fetch instead. It offers the parts of EventSource that useLiveUpdates uses, including
 * reconnecting after the server's `retry:` interval when the stream drops or is refused.
 */

type Listener = (event: MessageEvent<string>) => void;

/** Until the server says otherwise (its `retry:` line). */
const DEFAULT_RETRY_MS = 3_000;

export class AuthorizedEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly url: string;
  private readonly getHeaders: () => Promise<Record<string, string>>;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly controller = new AbortController();
  private retryMs = DEFAULT_RETRY_MS;

  constructor(url: string, getHeaders: () => Promise<Record<string, string>>) {
    this.url = url;
    this.getHeaders = getHeaders;
    void this.run();
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  close(): void {
    this.controller.abort();
  }

  private async run(): Promise<void> {
    const { signal } = this.controller;
    while (!signal.aborted) {
      try {
        const response = await fetch(this.url, { headers: await this.getHeaders(), signal, cache: 'no-store' });
        if (!response.ok || !response.body) throw new Error(`Event stream refused (HTTP ${response.status})`);
        this.onopen?.();
        const parser = new EventStreamParser();
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const { type, data } of parser.push(value)) {
            this.listeners.get(type)?.forEach((listener) => listener(new MessageEvent(type, { data })));
          }
          if (parser.retryMs !== null) this.retryMs = parser.retryMs;
        }
      } catch {
        // Refused, dropped or unreachable: handled below, like a stream that ended.
      }
      if (signal.aborted) return;
      this.onerror?.();
      await wait(this.retryMs, signal);
    }
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Turns the text of an event stream into events, however the text arrives in chunks. */
export class EventStreamParser {
  /** The server's requested reconnection delay, once it has sent one. */
  retryMs: number | null = null;
  private buffer = '';

  push(text: string): { type: string; data: string }[] {
    this.buffer += text;
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop()!; // an unfinished event waits for the next chunk
    const events: { type: string; data: string }[] = [];
    for (const block of blocks) {
      let type = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue; // a comment (the server's keep-alive)
        const [field, ...rest] = line.split(':');
        const value = rest.join(':').replace(/^ /, '');
        if (field === 'event') type = value;
        else if (field === 'data') data.push(value);
        else if (field === 'retry' && /^\d+$/.test(value)) this.retryMs = Number(value);
      }
      if (data.length > 0) events.push({ type, data: data.join('\n') });
    }
    return events;
  }
}
