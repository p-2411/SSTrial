import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ME_PATH, type CurrentMember } from '@label-extractor/shared';
import { ApiRequestError, apiRequest, errorMessage, setAuthHooks } from '@/api/client';
import { loadSupabaseAuthClient, type AuthClient } from './authClient';

export type AuthState =
  | { status: 'loading' }
  /** `notice` explains why, when it isn't just "nobody has signed in yet". */
  | { status: 'signed-out'; notice: string | null }
  | { status: 'signed-in'; member: CurrentMember };

interface AuthContextValue {
  state: AuthState;
  /** Resolves with a message to show, or null once the sign-in went through. */
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NO_ACCESS = "Your account doesn't have access to this workspace. Ask an admin to add you.";

/**
 * Who is signed in, for the whole app. Loads Supabase Auth, attaches its token to every API request
 * and signs out when the API stops accepting it. Signing out (here, or in another tab) clears
 * everything cached, so the next person to sign in on this browser sees none of it.
 */
export function AuthProvider({
  children,
  loadClient = loadSupabaseAuthClient,
}: {
  children: ReactNode;
  loadClient?: () => Promise<AuthClient>;
}) {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<AuthClient | null>(null);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  /** Asks the API who this is: a member, someone without access, or no valid sign-in at all. */
  const loadMember = useCallback(async (auth: AuthClient) => {
    if (!(await auth.getAccessToken())) {
      setState({ status: 'signed-out', notice: null });
      return;
    }
    try {
      setState({ status: 'signed-in', member: await apiRequest<CurrentMember>(ME_PATH) });
    } catch (error) {
      const noAccess = error instanceof ApiRequestError && error.status === 403;
      if (noAccess) await auth.signOut();
      const expired = error instanceof ApiRequestError && error.status === 401;
      setState({ status: 'signed-out', notice: noAccess ? NO_ACCESS : expired ? null : errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    loadClient()
      .then(async (auth) => {
        if (cancelled) return;
        setAuthHooks({ getAccessToken: () => auth.getAccessToken(), onUnauthorized: () => void auth.signOut() });
        unsubscribe = auth.onSignedOut(() => {
          queryClient.clear();
          setState((current) => (current.status === 'signed-out' ? current : { status: 'signed-out', notice: null }));
        });
        setClient(auth);
        await loadMember(auth);
      })
      .catch((error: unknown) => setState({ status: 'signed-out', notice: errorMessage(error) }));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadClient, loadMember, queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) return 'Still starting up. Try again in a moment.';
      const error = await client.signIn(email, password);
      if (error) return error;
      await loadMember(client);
      return null;
    },
    [client, loadMember],
  );

  // The onSignedOut listener above does the clearing, however the sign-out happened.
  const signOut = useCallback(async () => {
    await client?.signOut();
  }, [client]);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const auth = use(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>.');
  return auth;
}

/** The signed-in member. Only for components under RequireAuth, where there always is one. */
export function useSignedInMember(): CurrentMember {
  const { state } = useAuth();
  if (state.status !== 'signed-in') throw new Error('useSignedInMember must be used under <RequireAuth>.');
  return state.member;
}
