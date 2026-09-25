import type { ApiErrorBody } from '@label-extractor/shared';

/**
 * A failed API call, carrying the server's error code and its user-facing message.
 * `status` is 0 when the server couldn't be reached at all.
 */
export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Fetches JSON from our API. Every failure becomes an ApiRequestError with a readable message. */
export async function apiRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    // Our API always sends { error: { code, message } }. No body means something in front of it
    // (proxy, load balancer) answered instead — usually because the API is down or restarting.
    const fallback =
      response.status >= 500
        ? "The server isn't responding right now. Please try again in a moment."
        : `The request failed (HTTP ${response.status}).`;
    throw new ApiRequestError(response.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? fallback);
  }
  return (await response.json()) as T;
}

/** A message suitable for showing to the user, whatever was thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
