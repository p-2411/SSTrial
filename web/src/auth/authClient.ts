import { GoTrueClient } from '@supabase/auth-js';
import { CONFIG_PATH, type PublicConfig } from '@label-extractor/shared';

/** The parts of Supabase Auth the app uses, so AuthProvider can be tested with a fake. */
export interface AuthClient {
  /** The current access token (Supabase refreshes it before it expires), or null when signed out. */
  getAccessToken(): Promise<string | null>;
  /** Resolves with a message to show, or null once signed in. */
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** Calls `listener` whenever this browser signs out: here, in another tab, or when the session ends. */
  onSignedOut(listener: () => void): () => void;
}

let loading: Promise<AuthClient> | undefined;

/**
 * Supabase Auth, set up from the API's public config, so one build works in every environment.
 * Created once: several clients in one page would compete over the stored session.
 */
export function loadSupabaseAuthClient(): Promise<AuthClient> {
  loading ??= createAuthClient().catch((error: unknown) => {
    loading = undefined; // let the next attempt try again
    throw error;
  });
  return loading;
}

async function createAuthClient(): Promise<AuthClient> {
  const response = await fetch(CONFIG_PATH).catch(() => null);
  if (!response?.ok) throw new Error("Can't reach the server. Check your connection and try again.");
  const config = (await response.json()) as PublicConfig;
  // Only Supabase's auth client, not the full supabase-js: the browser never talks to the database
  // or storage through it, and the rest would more than double the size of this module.
  const auth = new GoTrueClient({
    url: `${config.supabaseUrl}/auth/v1`,
    headers: { apikey: config.supabasePublishableKey },
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // no emailed sign-in links
  });

  return {
    async getAccessToken() {
      const { data } = await auth.getSession();
      return data.session?.access_token ?? null;
    },
    async signIn(email, password) {
      const { error } = await auth.signInWithPassword({ email, password });
      if (!error) return null;
      return error.code === 'invalid_credentials' ? 'Wrong email or password.' : error.message;
    },
    async signOut() {
      await auth.signOut();
    },
    onSignedOut(listener) {
      const { data } = auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') listener();
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
