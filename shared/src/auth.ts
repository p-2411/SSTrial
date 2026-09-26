/**
 * Who can do what. Members do the work (upload, review, export); admins can also see how the
 * system is running (System status, the Activity log).
 */
export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Whether this person may delete an upload: whoever uploaded it, or any admin. Uploads from before
 * sign-in existed have no uploader, so only admins can delete those.
 */
export function canDeleteUpload(uploaderId: string | null, person: { id: string; role: Role }): boolean {
  return person.role === 'admin' || (uploaderId !== null && uploaderId === person.id);
}

/** GET /api/me — the signed-in person. */
export interface CurrentMember {
  id: string;
  email: string;
  role: Role;
}

/** GET /api/config — what the browser needs to sign in. Public values, by design. */
export interface PublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export const ME_PATH = '/api/me';
export const CONFIG_PATH = '/api/config';
