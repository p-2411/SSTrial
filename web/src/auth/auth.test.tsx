import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
import { apiRequest } from '@/api/client';
import { createTestQueryClient, jsonResponse } from '@/test/render';
import type { AuthClient } from './authClient';
import { AuthProvider, useAuth } from './AuthProvider';
import { RequireAuth, RequireRole } from './guards';
import { SignInPage } from './SignInPage';

/** Supabase Auth, in memory: the password is always "right". */
class FakeAuthClient implements AuthClient {
  token: string | null = null;
  private readonly listeners = new Set<() => void>();
  async getAccessToken() {
    return this.token;
  }
  async signIn(_email: string, password: string) {
    if (password !== 'right') return 'Wrong email or password.';
    this.token = 'token';
    return null;
  }
  async signOut() {
    this.token = null;
    this.listeners.forEach((listener) => listener());
  }
  onSignedOut(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const MEMBER: CurrentMember = { id: 'u1', email: 'member@example.com', role: 'member' };
let auth: FakeAuthClient;
/** What GET /api/me answers: the member, or a 403 for an account without access. */
let me: Response;

beforeEach(() => {
  auth = new FakeAuthClient();
  me = jsonResponse(MEMBER);
  vi.stubGlobal('fetch', vi.fn(async () => me.clone()));
});
afterEach(() => vi.unstubAllGlobals());

/** A page with a way to sign out, as the app's sidebar has. */
function UploadsPage() {
  const { signOut } = useAuth();
  return (
    <>
      <p>Uploads page</p>
      <button onClick={() => void signOut()}>Sign out</button>
    </>
  );
}

function renderApp(url = '/', loadClient: () => Promise<AuthClient> = async () => auth) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider loadClient={loadClient}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/sign-in" element={<SignInPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <UploadsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/status"
              element={
                <RequireAuth>
                  <RequireRole role="admin">
                    <p>Status page</p>
                  </RequireRole>
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function signIn(password: string) {
  await userEvent.type(await screen.findByLabelText('Email'), 'member@example.com');
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in', () => {
  it('sends signed-out visitors to the sign-in page, then back to the app once signed in', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await signIn('right');
    expect(await screen.findByText('Uploads page')).toBeInTheDocument();
  });

  it('says so when the password is wrong', async () => {
    renderApp();
    await signIn('wrong');
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
  });

  it('explains an account without access, instead of looping back to the app', async () => {
    me = jsonResponse({ error: { code: 'FORBIDDEN', message: 'No access' } }, 403);
    renderApp();
    await signIn('right');

    expect(await screen.findByText(/doesn't have access/)).toBeInTheDocument();
    expect(auth.token).toBeNull();
  });

  it('recovers from a failed start once the server is back, without a reload', async () => {
    const loadClient = vi.fn(async () => auth);
    loadClient.mockRejectedValueOnce(new Error("Can't reach the server. Check your connection and try again."));
    renderApp('/', loadClient);
    expect(await screen.findByText(/Can't reach the server/)).toBeInTheDocument();

    await signIn('right');
    expect(await screen.findByText('Uploads page')).toBeInTheDocument();
    expect(loadClient).toHaveBeenCalledTimes(2);
  });
});

describe('signing out', () => {
  it('returns to the sign-in page, saying why, when the session ends elsewhere', async () => {
    auth.token = 'token';
    renderApp();
    expect(await screen.findByText('Uploads page')).toBeInTheDocument();

    await act(() => auth.signOut()); // e.g. in another tab, or the token expired
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Your session ended. Sign in again.')).toBeInTheDocument();
  });

  it("doesn't explain a sign-out the person asked for", async () => {
    auth.token = 'token';
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stops sending the token once unmounted', async () => {
    auth.token = 'token';
    const { unmount } = renderApp();
    expect(await screen.findByText('Uploads page')).toBeInTheDocument();
    unmount();

    await apiRequest('/api/uploads');
    const [, init] = vi.mocked(fetch).mock.calls.at(-1) as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('roles', () => {
  it('tells a member that a page is for admins, rather than showing it', async () => {
    auth.token = 'token';
    renderApp('/status');
    expect(await screen.findByText('Only admins can see this page.')).toBeInTheDocument();
    expect(screen.queryByText('Status page')).not.toBeInTheDocument();
  });
});
