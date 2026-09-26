import type { Role } from '@label-extractor/shared';
import { useAuth } from './AuthProvider';

/** How each role is named to people. Keyed by role, so a new one fails to compile until it's named. */
export const ROLE_LABELS = {
  admin: 'Admin',
  member: 'Member',
} as const satisfies Record<Role, string>;

/** Whether someone is signed in with this role. What they can see follows from it; the API enforces it too. */
export function useHasRole(role: Role): boolean {
  const { state } = useAuth();
  return state.status === 'signed-in' && state.member.role === role;
}
