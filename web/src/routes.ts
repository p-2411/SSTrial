/**
 * Every address in the app, so links and route definitions can't drift apart. The router itself is
 * in app/router.tsx.
 */

/** Where signed-out visitors are sent. Outside the app shell. */
export const SIGN_IN_PATH = '/sign-in';

/** The upload list (the home page). */
export const HOME_PATH = '/';

/** System status: the queue, the worker, health checks and throughput. */
export const STATUS_PATH = '/status';

/** The activity log: what happened to each upload and to the system. */
export const LOGS_PATH = '/logs';

/** One upload open in a panel beside the list; the pattern the router and useMatch use. */
export const UPLOAD_PATH_PATTERN = '/uploads/:id';

export function uploadPath(id: string): string {
  return `/uploads/${id}`;
}
