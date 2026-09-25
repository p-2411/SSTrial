import { createBrowserRouter, Outlet } from 'react-router';
import { RequireAuth, RequireRole } from '@/auth/guards';
import { SignInPage } from '@/auth/SignInPage';
import { loadLogsPage } from '@/features/logs/loadLogsPage';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';
import { UploadsPage } from '@/features/uploads-list/UploadsPage';
import { HOME_PATH, LOGS_PATH, SIGN_IN_PATH, STATUS_PATH, UPLOAD_PATH_PATTERN } from '@/routes';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';

/**
 * Routes. /sign-in stands alone; everything else needs a signed-in member and sits inside the app
 * shell (sidebar + top bar):
 *   /             upload + list
 *   /uploads/:id  the same page, with that upload's details in a panel beside the list
 *   /status       system status: the queue, the worker, health checks, throughput and failures
 *   /logs         the activity log: what happened to each upload and to the system
 * The upload routes accept ?status=… to filter the list (see statusFilters.ts), and /logs accepts
 * ?level=…&type=…&upload=… (see logFilters.ts). Desktop layout only.
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
          // Their own chunks, loaded on first visit (see loadSystemStatusPage, loadLogsPage).
          { path: STATUS_PATH, lazy: async () => ({ Component: (await loadSystemStatusPage()).SystemStatusPage }) },
          { path: LOGS_PATH, lazy: async () => ({ Component: (await loadLogsPage()).LogsPage }) },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
