import { Link, matchPath, useLocation } from 'react-router';
import { Activity, Files, ScanText, ScrollText } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { AlertSeverity } from '@label-extractor/shared';
import { useOpsStatus } from '@/api/queries';
import { loadLogsPage } from '@/features/logs/loadLogsPage';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';
import { worstOpenSeverity } from '@/features/system-status/systemState';
import { cn } from '@/lib/utils';
import { HOME_PATH, LOGS_PATH, STATUS_PATH, UPLOAD_PATH_PATTERN } from '@/routes';

/**
 * The alert dot, in the status page's alert colours. Each tone's most saturated colour, so it
 * stands out on the dark sidebar: red for danger, and for warning the yellow of its border (its
 * text colour is a dark brown that would disappear here).
 */
const SEVERITY_DOT: Record<AlertSeverity, string> = { critical: 'bg-danger', warning: 'bg-warning-border' };

/**
 * The app shell's dark sidebar, following the SupplyScope product layout. It holds destinations
 * only: Uploads, System status and the activity log. Filtering the upload list is not a
 * destination, so its status tabs live in the list itself.
 */
export function AppSidebar() {
  const { pathname } = useLocation();
  const { data: ops } = useOpsStatus();

  // The list and an open upload are both part of Uploads.
  const onUploadsPage = pathname === HOME_PATH || matchPath(UPLOAD_PATH_PATTERN, pathname) !== null;
  const onStatusPage = pathname === STATUS_PATH;
  const onLogsPage = pathname === LOGS_PATH;
  const openAlertCount = ops?.alerts.open.length ?? 0;
  const worstAlert = ops ? worstOpenSeverity(ops.alerts) : null;

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
                {worstAlert && (
                  <SidebarMenuBadge>
                    <span
                      className={cn('size-2 rounded-full', SEVERITY_DOT[worstAlert])}
                      aria-label={`${openAlertCount} open alert${openAlertCount === 1 ? '' : 's'}`}
                    />
                  </SidebarMenuBadge>
                )}
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
      </SidebarContent>

      <SidebarFooter className="px-4 pb-5 text-xs text-sidebar-foreground/60">Built for the SupplyScope trial</SidebarFooter>
    </Sidebar>
  );
}
