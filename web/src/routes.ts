/**
 * Every address in the app, so links and route definitions can't drift apart. The router itself is
 * in app/router.tsx.
 */

/** Where signed-out visitors are sent. Outside the app shell. */
export const SIGN_IN_PATH = '/sign-in';

/** The upload list (the home page). */
export const HOME_PATH = '/';

/** The System page: how the system is running, and the activity log. Admins only. */
export const SYSTEM_PATH = '/system';

/** Where System status and the activity log used to be: they lead to the System page now. */
export const FORMER_SYSTEM_PATHS = ['/status', '/logs'];

/** One upload open in a panel beside the list; the pattern the router and useMatch use. */
export const UPLOAD_PATH_PATTERN = '/uploads/:id';

export function uploadPath(id: string): string {
  return `/uploads/${id}`;
}
