import { createBrowserRouter, createPath, Navigate, Outlet, useLocation } from 'react-router';
import { RequireAuth, RequireRole } from '@/auth/guards';
import { SignInPage } from '@/auth/SignInPage';
import { loadSystemPage } from '@/features/system/loadSystemPage';
import { UploadsPage } from '@/features/uploads-list/UploadsPage';
import { loadPageCode } from '@/lib/loadPageCode';
import { FORMER_SYSTEM_PATHS, HOME_PATH, SIGN_IN_PATH, SYSTEM_PATH, UPLOAD_PATH_PATTERN } from '@/routes';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';

/**
 * Routes. /sign-in stands alone; everything else needs a signed-in member and sits inside the app
 * shell (sidebar + top bar):
 *   /             upload + list
 *   /uploads/:id  the same page, with that upload's details in a panel beside the list
 *   /system       how the system is running, then the activity log (admins only)
 * /system accepts the log's filters, ?q=…&type=…&upload=… (see logFilters.ts); the old /status
 * and /logs addresses lead there, filters and all. Desktop layout only.
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
          // Its own chunk, loaded on first visit (see loadSystemPage). After a deploy an open tab's
          // chunks are gone; loadPageCode reloads it onto the new build.
          {
            path: SYSTEM_PATH,
            lazy: async () => ({ Component: (await loadPageCode(loadSystemPage, { reload: openAfreshWhereGoing })).SystemPage }),
          },
          ...FORMER_SYSTEM_PATHS.map((path) => ({ path, element: <ToSystemPage /> })),
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** Where the System page used to be split in two: straight on to it, keeping any log filters. */
function ToSystemPage() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: SYSTEM_PATH, search }} replace />;
}

/**
 * Loads the app afresh at the page being opened. A page's code is fetched before the navigation to
 * it completes, so the address bar still shows the page being left; reloading that would land the
 * person back where they were. On a first load there's no navigation, and the address is right.
 */
function openAfreshWhereGoing(): void {
  const going = router.state.navigation.location;
  window.location.assign(going ? createPath(going) : window.location.href);
}
