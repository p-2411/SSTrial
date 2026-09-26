import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ME_PATH, type CurrentMember } from '@label-extractor/shared';
import { ApiRequestError, apiRequest, connectApi, errorMessage } from '@/api/client';
import { loadSupabaseAuthClient, type AuthClient } from './authClient';

type AuthState =
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
const SESSION_ENDED = 'Your session ended. Sign in again.';

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
  const mounted = useRef(false);
  /** Undoes the current connect(); replaced by each one, and run on unmount. */
  const disconnect = useRef(() => {});
  /** True while the person is signing themselves out, which needs no explaining (unlike an expiry). */
  const signingOut = useRef(false);

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
      // A refused sign-in also signs out (see connect), but that may land either side of this.
      const expired = error instanceof ApiRequestError && error.status === 401;
      setState({ status: 'signed-out', notice: noAccess ? NO_ACCESS : expired ? SESSION_ENDED : errorMessage(error) });
    }
  }, []);

  /**
   * Loads Supabase Auth and connects it to the app: requests carry its token, and any sign-out
   * clears what's cached. Throws if it can't load (say, the server is unreachable); a later call
   * tries again.
   */
  const connect = useCallback(
    async (): Promise<AuthClient> => {
      const auth = await loadClient();
      if (!mounted.current) return auth; // unmounted while it loaded: nothing to connect it to
      disconnect.current();
      const disconnectApi = connectApi({ getAccessToken: () => auth.getAccessToken(), onUnauthorized: () => void auth.signOut() });
      const unsubscribe = auth.onSignedOut(() => {
        queryClient.clear();
        // Anything but their own sign-out ended the session for them: it expired, or another tab signed out.
        const notice = signingOut.current ? null : SESSION_ENDED;
        setState((current) => (current.status === 'signed-out' ? current : { status: 'signed-out', notice }));
      });
      disconnect.current = () => {
        unsubscribe();
        disconnectApi();
      };
      setClient(auth);
      return auth;
    },
    [loadClient, queryClient],
  );

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    connect()
      .then(async (auth) => {
        if (!cancelled) await loadMember(auth);
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'signed-out', notice: errorMessage(error) });
      });
    return () => {
      mounted.current = false;
      cancelled = true;
      disconnect.current();
      disconnect.current = () => {};
    };
  }, [connect, loadMember]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      let auth = client;
      // Starting up failed (the sign-in page says why): try again now, rather than only after a reload.
      if (!auth) {
        try {
          auth = await connect();
        } catch (error) {
          return errorMessage(error);
        }
      }
      const error = await auth.signIn(email, password);
      if (error) return error;
      await loadMember(auth);
      return null;
    },
    [client, connect, loadMember],
  );

  // The onSignedOut listener in connect() does the clearing, however the sign-out happened.
  const signOut = useCallback(async () => {
    if (!client) return;
    signingOut.current = true;
    try {
      await client.signOut();
    } finally {
      signingOut.current = false;
    }
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
