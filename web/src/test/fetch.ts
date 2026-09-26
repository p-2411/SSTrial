import { vi } from 'vitest';

/*
 * The fake server tests talk to: fetch, stubbed. Every stub is removed after each test (setup.ts),
 * so tests needn't undo them.
 */

/** A JSON Response, as fetch would return it. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** What a proxy answers when the API behind it is down: no JSON, just a status. */
export function badGateway(): Response {
  return new Response('Bad gateway', { status: 502 });
}

/** A request the app made, as the fake server saw it. */
export interface SentRequest {
  url: string;
  method: string;
  /** The JSON it sent, parsed, if any. */
  body?: unknown;
}

/** Answers every request with `answer`'s response (or a promise of one), and records each. */
export function stubFetch(answer: (request: SentRequest) => Response | Promise<Response>): SentRequest[] {
  const requests: SentRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const request: SentRequest = { url, method: init?.method ?? 'GET' };
      if (init?.body) request.body = JSON.parse(String(init.body));
      requests.push(request);
      return answer(request);
    }),
  );
  return requests;
}

/**
 * Answers each request with the next of `pages` as JSON (the last one repeats): a list's pages,
 * say, or its first load and then a refresh. Returns the URLs asked for, in order.
 */
export function stubPages(...pages: unknown[]): string[] {
  const urls: string[] = [];
  stubFetch(({ url }) => {
    urls.push(url);
    return jsonResponse(pages[Math.min(urls.length - 1, pages.length - 1)]);
  });
  return urls;
}
