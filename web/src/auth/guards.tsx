import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Role } from '@label-extractor/shared';
import { PageSpinner } from '@/components/PageSpinner';
import { SIGN_IN_PATH } from '@/routes';
import { useAuth } from './AuthProvider';
import { ROLE_LABELS, useHasRole } from './roles';

/** Renders its children only for a signed-in member; sends anyone else to sign in, then back here. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return <PageSpinner className="min-h-svh" />;
  }
  if (state.status === 'signed-out') {
    return <Navigate to={SIGN_IN_PATH} replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

/** Renders its children only for members with this role. Goes under RequireAuth. The API refuses the data anyway. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  if (!useHasRole(role)) {
    return (
      <div className="grid flex-1 place-content-center p-6 text-center">
        <p className="text-muted-foreground">Only {ROLE_LABELS[role].toLowerCase()}s can see this page.</p>
      </div>
    );
  }
  return children;
}
