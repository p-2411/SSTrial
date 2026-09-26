import { createBrowserRouter, createPath, Outlet } from 'react-router';
import { RequireAuth, RequireRole } from '@/auth/guards';
import { SignInPage } from '@/auth/SignInPage';
import { loadLogsPage } from '@/features/logs/loadLogsPage';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';
import { UploadsPage } from '@/features/uploads-list/UploadsPage';
import { loadPageCode } from '@/lib/loadPageCode';
import { HOME_PATH, LOGS_PATH, SIGN_IN_PATH, STATUS_PATH, UPLOAD_PATH_PATTERN } from '@/routes';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';

/**
 * Routes. /sign-in stands alone; everything else needs a signed-in member and sits inside the app
 * shell (sidebar + top bar):
 *   /             upload + list
 *   /uploads/:id  the same page, with that upload's details in a panel beside the list
 *   /status       system status: the queue, the worker, health checks and throughput
 *   /logs         the activity log: what happened to each upload and to the system
 * The upload routes accept ?status=… to filter the list (see statusFilters.ts), and /logs accepts
 * ?type=…&type=…&upload=… (see logFilters.ts). Desktop layout only.
 */
export const router = createBrowserRouter([
  { path: SIGN_IN_PATH, element: <SignInPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      {
        path: HOME_PATH,
        element: <UploadsPage />,
        // Renders nothing itself: the route only has to match. UploadDetailPanel (always mounted, so
        // it can animate open and closed) reads it.
        children: [{ path: UPLOAD_PATH_PATTERN, element: null }],
      },
      {
        // How the system is running: admins only (the API enforces it too).
        element: (
          <RequireRole role="admin">
            <Outlet />
          </RequireRole>
        ),
        children: [
          // Their own chunks, loaded on first visit (see loadSystemStatusPage, loadLogsPage). After a
          // deploy an open tab's chunks are gone; loadPageCode reloads it onto the new build.
          {
            path: STATUS_PATH,
            lazy: async () => ({ Component: (await loadPageCode(loadSystemStatusPage, { reload: openAfreshWhereGoing })).SystemStatusPage }),
          },
          {
            path: LOGS_PATH,
            lazy: async () => ({ Component: (await loadPageCode(loadLogsPage, { reload: openAfreshWhereGoing })).LogsPage }),
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/**
 * Loads the app afresh at the page being opened. A page's code is fetched before the navigation to
 * it completes, so the address bar still shows the page being left; reloading that would land the
 * person back where they were. On a first load there's no navigation, and the address is right.
 */
function openAfreshWhereGoing(): void {
  const going = router.state.navigation.location;
  window.location.assign(going ? createPath(going) : window.location.href);
}
