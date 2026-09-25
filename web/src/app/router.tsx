import { createBrowserRouter } from 'react-router';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';
import { UploadsPage } from '@/features/uploads-list/UploadsPage';
import { HOME_PATH, STATUS_PATH, UPLOAD_PATH_PATTERN } from '@/routes';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';

/**
 * Routes, all inside the app shell (sidebar + top bar):
 *   /             upload + list
 *   /uploads/:id  the same page, with that upload's details in a panel beside the list
 *   /status       system status: health, queue, throughput and the alert log
 * The upload routes accept ?status=… to filter the list (see statusFilters.ts). Desktop layout only.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        path: HOME_PATH,
        element: <UploadsPage />,
        // Renders nothing itself: the route only has to match. UploadDetailPanel (always mounted, so
        // it can animate open and closed) reads it.
        children: [{ path: UPLOAD_PATH_PATTERN, element: null }],
      },
      // Its own chunk, loaded on first visit (see loadSystemStatusPage).
      { path: STATUS_PATH, lazy: async () => ({ Component: (await loadSystemStatusPage()).SystemStatusPage }) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
