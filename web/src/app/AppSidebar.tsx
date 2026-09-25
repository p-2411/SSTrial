import { Link, matchPath, useLocation } from 'react-router';
import { Activity, Files, LogOut, ScanText, ScrollText } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useAuth, useSignedInMember } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { loadLogsPage } from '@/features/logs/loadLogsPage';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';
import { HOME_PATH, LOGS_PATH, STATUS_PATH, UPLOAD_PATH_PATTERN } from '@/routes';

/**
 * The app shell's dark sidebar, following the SupplyScope product layout. It holds destinations
 * only (Uploads for everyone; System status and the activity log for admins), then who is signed
 * in. Filtering the upload list is not a destination, so its status tabs live in the list itself.
 */
export function AppSidebar() {
  const { pathname } = useLocation();
  const member = useSignedInMember();
  const { signOut } = useAuth();

  // The list and an open upload are both part of Uploads.
  const onUploadsPage = pathname === HOME_PATH || matchPath(UPLOAD_PATH_PATTERN, pathname) !== null;
  const onStatusPage = pathname === STATUS_PATH;
  const onLogsPage = pathname === LOGS_PATH;

  return (
    <Sidebar>
      <SidebarHeader className="px-4 pt-5 pb-3">
        <Link to={HOME_PATH} className="flex items-center gap-2.5 rounded-md text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <span className="grid size-8 place-items-center rounded-lg bg-white text-sidebar-primary-foreground">
            <ScanText className="size-4.5" aria-hidden />
          </span>
          {/* Two weights in one word, like the SupplyScope wordmark. */}
          <span className="text-lg tracking-[-0.03em]">
            <span className="font-light">Label</span>
            <span className="font-bold">Extractor</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/60">Label extraction</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={onUploadsPage}>
                  <Link to={HOME_PATH} aria-current={onUploadsPage ? 'page' : undefined}>
                    <Files aria-hidden />
                    <span>Uploads</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {member.role === 'admin' && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/60">System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={onStatusPage}>
                    {/* The page's code is split out; start fetching it as soon as a visit looks likely. */}
                    <Link
                      to={STATUS_PATH}
                      aria-current={onStatusPage ? 'page' : undefined}
                      onMouseEnter={() => void loadSystemStatusPage()}
                      onFocus={() => void loadSystemStatusPage()}
                    >
                      <Activity aria-hidden />
                      <span>System status</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={onLogsPage}>
                    <Link
                      to={LOGS_PATH}
                      aria-current={onLogsPage ? 'page' : undefined}
                      onMouseEnter={() => void loadLogsPage()}
                      onFocus={() => void loadLogsPage()}
                    >
                      <ScrollText aria-hidden />
                      <span>Activity log</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2 px-4 pb-5">
        <div className="min-w-0 text-xs">
          <p className="truncate font-medium text-white" title={member.email}>
            {member.email}
          </p>
          <p className="text-sidebar-foreground/60">{member.role === 'admin' ? 'Admin' : 'Member'}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start px-0 text-sidebar-foreground/80 hover:bg-transparent hover:text-white"
          onClick={() => void signOut()}
        >
          <LogOut data-icon="inline-start" aria-hidden />
          Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
