import { Link, useLocation } from 'react-router';
import { Activity, ScanText } from 'lucide-react';
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
import { useOpsStatus, useUploadCounts } from '@/api/queries';
import { cn } from '@/lib/utils';
import { filterSearch, STATUS_FILTERS, useStatusFilter } from '@/features/uploads-list/statusFilters';

/**
 * The app shell's dark sidebar, following the SupplyScope product layout. Its navigation is the
 * status filter for the upload list, with live counts.
 */
export function AppSidebar() {
  const filter = useStatusFilter();
  const { pathname } = useLocation();
  const { data: counts } = useUploadCounts();
  const { data: ops } = useOpsStatus();

  const onStatusPage = pathname === '/status';
  // Filters apply to the uploads pages; from elsewhere they lead back to the list.
  const filterPathname = onStatusPage ? '/' : pathname;
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
              {STATUS_FILTERS.map((item) => {
                const count = counts?.[item.id];
                const isActive = !onStatusPage && item === filter;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      {/* Keep the open upload (if any) when switching filters. */}
                      <Link to={{ pathname: filterPathname, search: filterSearch(item) }} aria-current={isActive ? 'page' : undefined}>
                        <item.icon aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {count !== undefined && <SidebarMenuBadge className="tabular-nums">{count}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/60">System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={onStatusPage}>
                  <Link to="/status" aria-current={onStatusPage ? 'page' : undefined}>
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
