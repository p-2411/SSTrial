import { Link, useLocation } from 'react-router';
import { Activity, Files, ScanText } from 'lucide-react';
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
import { useOpsStatus } from '@/api/queries';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';
import { cn } from '@/lib/utils';

/**
 * The app shell's dark sidebar, following the SupplyScope product layout. It holds destinations
 * only: Uploads and System status. Filtering the upload list is not a destination, so its status
 * tabs live in the list itself.
 */
export function AppSidebar() {
  const { pathname } = useLocation();
  const { data: ops } = useOpsStatus();

  const onStatusPage = pathname === '/status';
  const openAlerts = ops?.alerts.open ?? [];
  const worstAlert = openAlerts.some((alert) => alert.severity === 'critical') ? 'critical' : openAlerts.length ? 'warning' : null;

  return (
    <Sidebar>
      <SidebarHeader className="px-4 pt-5 pb-3">
        <Link to="/" className="flex items-center gap-2.5 rounded-md text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
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
                {/* The list and an open upload are both part of Uploads. */}
                <SidebarMenuButton asChild isActive={!onStatusPage}>
                  <Link to="/" aria-current={onStatusPage ? undefined : 'page'}>
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
                    to="/status"
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
                      className={cn('size-2 rounded-full', worstAlert === 'critical' ? 'bg-destructive' : 'bg-amber-400')}
                      aria-label={`${openAlerts.length} open alert${openAlerts.length === 1 ? '' : 's'}`}
                    />
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 pb-5 text-xs text-sidebar-foreground/60">Built for the SupplyScope trial</SidebarFooter>
    </Sidebar>
  );
}
