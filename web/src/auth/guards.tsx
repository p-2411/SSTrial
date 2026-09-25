import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';
import type { Role } from '@label-extractor/shared';
import { SIGN_IN_PATH } from '@/routes';
import { useAuth } from './AuthProvider';

/** Renders its children only for a signed-in member; sends anyone else to sign in, then back here. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="grid min-h-svh place-content-center" role="status" aria-label="Loading">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (state.status === 'signed-out') {
    return <Navigate to={SIGN_IN_PATH} replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

/** Renders its children only for members with this role. The API refuses the data anyway. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'signed-in' && state.member.role !== role) {
    return (
      <div className="grid flex-1 place-content-center p-6 text-center">
        <p className="text-muted-foreground">Only {role}s can see this page.</p>
      </div>
    );
  }
  return children;
}
