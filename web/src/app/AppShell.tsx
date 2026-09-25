import { Outlet, useMatch, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { UploadSummary } from '@label-extractor/shared';
import { useLiveUpdates } from '@/api/useLiveUpdates';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { FileUploadsProvider } from '@/features/upload/FileUploadsProvider';
import { STATUS_PATH, uploadPath } from '@/routes';
import { AppSidebar } from './AppSidebar';

/**
 * App shell in the SupplyScope layout: dark sidebar, white top bar, warm off-white workspace.
 * Uploads in progress live here, so they carry on while you look at another page. SidebarInset
 * renders the page's <main> element, so nothing inside it is another <main>.
 */
export function AppShell() {
  const navigate = useNavigate();
  useLiveUpdates();

  // A file the server already had isn't processed again: point to the upload it already has.
  const onDuplicate = (existing: UploadSummary, file: File) => {
    toast(`${file.name} was already uploaded`, {
      description: 'Showing the existing upload instead of processing it again.',
      action: { label: 'View', onClick: () => void navigate(uploadPath(existing.id)) },
    });
  };

  return (
    <FileUploadsProvider onDuplicate={onDuplicate}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="h-svh overflow-hidden bg-background">
          <TopBar />
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </FileUploadsProvider>
  );
}

function TopBar() {
  const onStatusPage = useMatch(STATUS_PATH) !== null;
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
