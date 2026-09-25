import { createBrowserRouter, Link, Outlet, useMatch, useOutletContext } from 'react-router';
import { useLiveUpdates } from '@/api/useLiveUpdates';
import { AppSidebar } from '@/components/AppSidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Dropzone } from '@/features/upload/Dropzone';
import { useFileUploads } from '@/features/upload/useFileUploads';
import { UploadDetailPanel } from '@/features/upload-detail/UploadDetailPanel';
import { UploadList } from '@/features/uploads-list/UploadList';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';

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
        path: '/',
        element: <Workspace />,
        // Renders nothing itself: the route only has to match. UploadDetailPanel (always mounted, so
        // it can animate open and closed) reads it.
        children: [{ path: 'uploads/:id', element: null }],
      },
      // Its own chunk, loaded on first visit (see loadSystemStatusPage).
      { path: '/status', lazy: async () => ({ Component: (await loadSystemStatusPage()).SystemStatusPage }) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

type FileUploads = ReturnType<typeof useFileUploads>;

/**
 * App shell in the SupplyScope layout: dark sidebar, white top bar, warm off-white workspace.
 * Uploads in progress live here, so they carry on while you look at another page. SidebarInset
 * renders the page's <main> element, so nothing inside it is another <main>.
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

/** The uploads page: dropzone and list, with the open upload in a panel beside them. */
function Workspace() {
  const { uploads: pending, addFiles, retry, dismiss } = useOutletContext<FileUploads>();
  return (
    // Full height: the list and the detail panel each scroll on their own.
    // @container: the detail panel sizes itself as a share of this row's width.
    <div className="@container flex min-h-0 flex-1">
      {/* The scrollbar's space is always reserved, on both sides so the centred content stays
          centred: switching to a short filter mustn't make everything shift sideways. */}
      <div data-slot="list-scroller" className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        <div className="mx-auto grid max-w-4xl content-start gap-4 p-6">
          <Dropzone onFiles={addFiles} />
          <UploadList pending={pending} onRetryPending={retry} onDismissPending={dismiss} />
        </div>
      </div>
      <UploadDetailPanel />
    </div>
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
