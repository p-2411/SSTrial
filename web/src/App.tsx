import { createBrowserRouter, Link, Outlet, useMatch, useOutletContext } from 'react-router';
import { useLiveUpdates } from '@/api/useLiveUpdates';
import { AppSidebar } from '@/components/AppSidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Dropzone } from '@/features/upload/Dropzone';
import { useFileUploads } from '@/features/upload/useFileUploads';
import { NothingSelected } from '@/features/upload-detail/NothingSelected';
import { UploadDetailView } from '@/features/upload-detail/UploadDetailView';
import { UploadList } from '@/features/uploads-list/UploadList';
import { SystemStatusPage } from '@/features/system-status/SystemStatusPage';

/**
 * Routes, all inside the app shell (sidebar + top bar):
 *   /             upload + list, with a placeholder where the detail goes
 *   /uploads/:id  upload + list, with that upload's detail alongside
 *   /status       system status: health, queue, throughput and the alert log
 * The upload routes accept ?status=… to filter the list (see statusFilters.ts). Desktop layout only.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        path: '/',
        element: <Workspace />,
        children: [
          { index: true, element: <NothingSelected /> },
          { path: 'uploads/:id', element: <UploadDetailView /> },
        ],
      },
      { path: '/status', element: <SystemStatusPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

type FileUploads = ReturnType<typeof useFileUploads>;

/**
 * App shell in the SupplyScope layout: dark sidebar, white top bar, warm off-white workspace.
 * Uploads in progress live here, so they carry on while you look at another page.
 */
function AppShell() {
  const fileUploads = useFileUploads();
  useLiveUpdates();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden bg-background">
        <TopBar />
        <Outlet context={fileUploads satisfies FileUploads} />
      </SidebarInset>
    </SidebarProvider>
  );
}

/** The uploads page: dropzone and list on the left, the open upload on the right. */
function Workspace() {
  const { uploads: pending, addFiles, retry, dismiss } = useOutletContext<FileUploads>();
  return (
    // Full height: the list and the detail each scroll on their own.
    <main className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-4 overflow-y-auto p-6 pr-3">
        <Dropzone onFiles={addFiles} />
        <UploadList pending={pending} onRetryPending={retry} onDismissPending={dismiss} />
      </div>
      <div className="min-w-0 overflow-y-auto p-6 pl-3">
        <Outlet />
      </div>
    </main>
  );
}

function TopBar() {
  const onStatusPage = useMatch('/status') !== null;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
      <h1 className="text-base font-semibold">{onStatusPage ? 'System status' : 'Label extraction'}</h1>
      {/* The indigo BETA pill SupplyScope puts beside new AI features. */}
      {!onStatusPage && (
        <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] leading-none font-semibold tracking-wide text-brand-foreground">
          BETA
        </span>
      )}
    </header>
  );
}

function NotFoundPage() {
  return (
    <main className="grid min-h-svh place-content-center gap-2 p-6 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        There's nothing at this address.{' '}
        <Link to="/" className="font-semibold text-foreground underline underline-offset-4">
          Go to your uploads
        </Link>
      </p>
    </main>
  );
}
