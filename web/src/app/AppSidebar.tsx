import { useId, useState } from 'react';
import { Link, matchPath, useLocation } from 'react-router';
import { Activity, Files, LogOut, ScanText, ScrollText, type LucideIcon } from 'lucide-react';
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
import { ROLE_LABELS, useHasRole } from '@/auth/roles';
import { Button } from '@/components/ui/button';
import { loadLogsPage } from '@/features/logs/loadLogsPage';
import { loadSystemStatusPage } from '@/features/system-status/loadSystemStatusPage';
import { useFileUploadsContext } from '@/features/upload/FileUploadsProvider';
import { HOME_PATH, LOGS_PATH, STATUS_PATH, UPLOAD_PATH_PATTERN } from '@/routes';

/**
 * The app shell's dark sidebar, following the SupplyScope product layout. It holds destinations
 * only (Uploads for everyone; System status and the activity log for admins), then who is signed
 * in. Filtering the upload list is not a destination, so its status tabs live in the list itself.
 */
export function AppSidebar() {
  const { pathname } = useLocation();
  const member = useSignedInMember();
  const isAdmin = useHasRole('admin');

  // The list and an open upload are both part of Uploads.
  const onUploadsPage = pathname === HOME_PATH || matchPath(UPLOAD_PATH_PATTERN, pathname) !== null;

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
              <NavItem to={HOME_PATH} icon={Files} label="Uploads" active={onUploadsPage} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/60">System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavItem
                  to={STATUS_PATH}
                  icon={Activity}
                  label="System status"
                  active={pathname === STATUS_PATH}
                  preload={loadSystemStatusPage}
                />
                <NavItem to={LOGS_PATH} icon={ScrollText} label="Activity log" active={pathname === LOGS_PATH} preload={loadLogsPage} />
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
          <p className="text-sidebar-foreground/60">{ROLE_LABELS[member.role]}</p>
        </div>
        <SignOut />
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * One destination. A page whose code is split out passes `preload`, to start fetching it as soon
 * as a visit looks likely (hover or focus).
 */
function NavItem({
  to,
  icon: Icon,
  label,
  active,
  preload,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  preload?: () => Promise<unknown>;
}) {
  const startLoading = preload && (() => void preload());
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <Link to={to} aria-current={active ? 'page' : undefined} onMouseEnter={startLoading} onFocus={startLoading}>
          <Icon aria-hidden />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Signs out, but asks first while files are still uploading: signing out leaves the app, which
 * stops them without a trace. Its own component, so upload progress re-renders only this.
 */
function SignOut() {
  const { signOut } = useAuth();
  const { busy } = useFileUploadsContext();
  const [confirming, setConfirming] = useState(false);
  const questionId = useId();

  // Uploads that finish meanwhile leave nothing to ask about.
  if (confirming && !busy) setConfirming(false);

  if (confirming && busy) {
    return (
      <div role="group" aria-labelledby={questionId} className="grid gap-2 text-xs">
        <p id={questionId} className="text-white">
          Files are still uploading. Signing out now stops them.
        </p>
        <div className="flex gap-1.5">
          <Button size="xs" variant="secondary" onClick={() => void signOut()}>
            Sign out anyway
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-sidebar-foreground/80 hover:bg-white/10 hover:text-white"
            onClick={() => setConfirming(false)}
            autoFocus
          >
            Keep uploading
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start px-0 text-sidebar-foreground/80 hover:bg-transparent hover:text-white"
      onClick={() => (busy ? setConfirming(true) : void signOut())}
    >
      <LogOut data-icon="inline-start" aria-hidden />
      Sign out
    </Button>
  );
}
