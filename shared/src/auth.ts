/**
 * Who can do what. Members do the work (upload, review, export); admins can also see how the
 * system is running (the System page: its status and the activity log).
 */
const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** What the rules below need to know about an upload: whose it is, and whether it's in Products. */
export interface UploadOwnership {
  /** In Products (see isProduct), so everyone's. */
  product: boolean;
  /** Who uploaded it (a user ID); null for uploads from before sign-in existed. */
  uploaderId: string | null;
}

/**
 * Whether this person may see an upload at all. A submitted product is everyone's. Until then (being
 * read, failed, or waiting for review) it's its uploader's alone: nobody else can open it or even
 * list it. (Uploads from before sign-in existed have no uploader, so admins see those, to tidy up.)
 * The API answers as if an upload someone can't see doesn't exist, whatever they asked to do with it.
 */
export function canViewUpload(upload: UploadOwnership, person: Pick<CurrentMember, 'id' | 'role'>): boolean {
  if (upload.product) return true;
  return upload.uploaderId === null ? person.role === 'admin' : upload.uploaderId === person.id;
}

/**
 * Whether this person may delete an upload: one they can see, that they uploaded, or any admin.
 * Uploads from before sign-in existed have no uploader, so only admins can delete those. The same
 * people may have one read again, which takes a product out of Products just as surely.
 */
export function canDeleteUpload(upload: UploadOwnership, person: Pick<CurrentMember, 'id' | 'role'>): boolean {
  if (!canViewUpload(upload, person)) return false;
  return person.role === 'admin' || (upload.uploaderId !== null && upload.uploaderId === person.id);
}

/** Whether this person may put an upload's data back to an earlier version: admins, on one they can see. */
export function canRevertUpload(upload: UploadOwnership, person: Pick<CurrentMember, 'id' | 'role'>): boolean {
  return person.role === 'admin' && canViewUpload(upload, person);
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
