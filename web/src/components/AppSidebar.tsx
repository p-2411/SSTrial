import { Link, useLocation } from 'react-router';
import { ScanText } from 'lucide-react';
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
import { useUploadList } from '@/api/queries';
import { filterSearch, STATUS_FILTERS, useStatusFilter } from '@/features/uploads-list/statusFilters';

/**
 * The app shell's dark sidebar, following the SupplyScope product layout. Its navigation is the
 * status filter for the upload list, with live counts.
 */
export function AppSidebar() {
  const active = useStatusFilter();
  const { pathname } = useLocation();
  const { data: uploads } = useUploadList();

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
              {STATUS_FILTERS.map((filter) => {
                const count = uploads?.filter((upload) => filter.matches(upload.status)).length;
                const isActive = filter === active;
                return (
                  <SidebarMenuItem key={filter.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      {/* Keep the open upload (if any) when switching filters. */}
                      <Link to={{ pathname, search: filterSearch(filter) }} aria-current={isActive ? 'page' : undefined}>
                        <filter.icon aria-hidden />
                        <span>{filter.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {count !== undefined && <SidebarMenuBadge className="tabular-nums">{count}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 pb-5 text-xs text-sidebar-foreground/60">Built for the SupplyScope trial</SidebarFooter>
    </Sidebar>
  );
}
