import { createBrowserRouter, Link } from 'react-router';
import { AppSidebar } from '@/components/AppSidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Dropzone } from '@/features/upload/Dropzone';
import { useFileUploads } from '@/features/upload/useFileUploads';
import { UploadDetailPanel } from '@/features/upload-detail/UploadDetailPanel';
import { UploadList } from '@/features/uploads-list/UploadList';

/**
 * Routes:
 *   /             upload + list
 *   /uploads/:id  the same page, with that upload's details in a panel beside the list
 * Both accept ?status=… to filter the list (see statusFilters.ts). Desktop layout only.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Workspace />,
    // Renders nothing itself: the route only has to match. UploadDetailPanel (always mounted, so it
    // can animate open and closed) reads it.
    children: [{ path: 'uploads/:id', element: null }],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** App shell in the SupplyScope layout: dark sidebar, white top bar, warm off-white workspace. */
function Workspace() {
  const { uploads: pending, addFiles, retry, dismiss } = useFileUploads();

  return (
    <SidebarProvider>
      <AppSidebar />
      {/* Full-height shell: the list and the detail panel scroll independently. SidebarInset renders
          the page's <main> element, so nothing inside it is another <main>. */}
      <SidebarInset className="h-svh overflow-hidden bg-background">
        <TopBar />
        {/* @container: the detail panel sizes itself as a share of this row's width. */}
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
      </SidebarInset>
    </SidebarProvider>
  );
}

function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
      <h1 className="text-base font-semibold">Label extraction</h1>
      {/* The indigo BETA pill SupplyScope puts beside new AI features. */}
      <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] leading-none font-semibold tracking-wide text-brand-foreground">
        BETA
      </span>
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
