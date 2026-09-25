import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
import { createTestQueryClient, jsonResponse } from '@/test/render';
import type { AuthClient } from './authClient';
import { AuthProvider } from './AuthProvider';
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

function renderApp(url = '/') {
  const loadClient = async () => auth;
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
                  <p>Uploads page</p>
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

  it('returns to the sign-in page when signed out elsewhere', async () => {
    auth.token = 'token';
    renderApp();
    expect(await screen.findByText('Uploads page')).toBeInTheDocument();

    await auth.signOut(); // e.g. in another tab
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
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
