import type { ApiErrorBody, ApiErrorCode } from '@label-extractor/shared';

/** The server's codes, plus two for when no answer came from our API at all. */
export type RequestErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'HTTP_ERROR';

/**
 * A failed API call, carrying the server's error code and its user-facing message.
 * `status` is 0 when the server couldn't be reached at all.
 */
export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  readonly status: number;
  readonly code: RequestErrorCode;

  constructor(status: number, code: RequestErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface AuthHooks {
  /** The signed-in user's access token, or null. Asked for on every request, so it's never stale. */
  getAccessToken(): Promise<string | null>;
  /** The API stopped accepting the sign-in (expired or revoked). */
  onUnauthorized(): void;
}

let authHooks: AuthHooks = { getAccessToken: async () => null, onUnauthorized: () => {} };

/** Set by AuthProvider once Supabase Auth has loaded. Until then (and in tests) requests carry no token. */
export function setAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

/** The header that tells our API who is asking, if anyone is signed in. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await authHooks.getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Calls our API as the signed-in user. Every failure becomes an ApiRequestError with a readable message. */
export async function apiFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const headers = await authHeaders();
  if (init.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    if (response.status === 401) authHooks.onUnauthorized();
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    // Our API always sends { error: { code, message } }. No body means something in front of it
    // (proxy, load balancer) answered instead — usually because the API is down or restarting.
    const fallback =
      response.status >= 500
        ? "The server isn't responding right now. Please try again in a moment."
        : `The request failed (HTTP ${response.status}).`;
    throw new ApiRequestError(response.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? fallback);
  }
  return response;
}

/** Calls our API and reads the JSON response. */
export async function apiRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return (await (await apiFetch(path, init)).json()) as T;
}

/** A message suitable for showing to the user, whatever was thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
