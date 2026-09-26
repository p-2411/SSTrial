import { useState } from 'react';
import { Link, matchPath, useLocation } from 'react-router';
import { Activity, ChevronsUpDown, Files, LogOut, ScanText, type LucideIcon } from 'lucide-react';
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { loadSystemPage } from '@/features/system/loadSystemPage';
import { useFileUploadsContext } from '@/features/upload/FileUploadsProvider';
import { HOME_PATH, SYSTEM_PATH, UPLOAD_PATH_PATTERN } from '@/routes';

/**
 * The app shell's dark sidebar, following the SupplyScope product layout. It holds destinations
 * only (Uploads for everyone; the System page, status and activity log, for admins), then who is
 * signed in.
 */
export function AppSidebar() {
  const { pathname } = useLocation();
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
            <SidebarMenu className="gap-1">
              <NavItem to={HOME_PATH} icon={Files} label="Uploads" active={onUploadsPage} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/60">System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <NavItem to={SYSTEM_PATH} icon={Activity} label="Status & activity" active={pathname === SYSTEM_PATH} preload={loadSystemPage} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-4">
        <ProfileMenu />
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
 * Who is signed in, as a button at the foot of the sidebar that opens a menu upwards with Sign out.
 * Signing out while files are still uploading asks first, since leaving the app stops them without
 * a trace. Its own component, so upload progress re-renders only this.
 */
function ProfileMenu() {
  const member = useSignedInMember();
  const { signOut } = useAuth();
  const { busy } = useFileUploadsContext();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signOutNow = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-sm font-semibold text-white uppercase">
                {member.email.charAt(0)}
              </span>
              <span className="grid min-w-0 flex-1 text-left text-xs leading-tight">
                <span className="truncate font-medium text-white" title={member.email}>
                  {member.email}
                </span>
                <span className="truncate text-sidebar-foreground/60">{ROLE_LABELS[member.role]}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/60" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          {/* Opens upwards, as wide as the button: it sits at the bottom of the screen. Dark grey, a
              shade lighter than the sidebar, so it reads as part of it rather than a white popup. */}
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) bg-sidebar-accent text-sidebar-accent-foreground ring-white/10"
          >
            <DropdownMenuItem
              className="focus:bg-white/10 focus:text-white not-data-[variant=destructive]:focus:**:text-white"
              onSelect={() => (busy ? setConfirming(true) : void signOutNow())}
            >
              <LogOut aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      {/* Uploads that finish meanwhile leave nothing to ask about, so the question goes too. */}
      <AlertDialog open={confirming && busy} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Files are still uploading</AlertDialogTitle>
            <AlertDialogDescription>Signing out now stops them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Keep uploading</Button>
            </AlertDialogCancel>
            <Button variant="destructive" loading={signingOut} onClick={() => void signOutNow()}>
              Sign out anyway
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenu>
  );
}
