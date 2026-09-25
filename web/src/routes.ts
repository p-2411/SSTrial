/**
 * Every address in the app, so links and route definitions can't drift apart. The router itself is
 * in app/router.tsx.
 */

/** The upload list (the home page). */
export const HOME_PATH = '/';

/** System status: health, queue, throughput and the alert log. */
export const STATUS_PATH = '/status';

/** One upload open in a panel beside the list; the pattern the router and useMatch use. */
export const UPLOAD_PATH_PATTERN = '/uploads/:id';

export function uploadPath(id: string): string {
  return `/uploads/${id}`;
}
