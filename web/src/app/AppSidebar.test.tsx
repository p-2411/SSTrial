import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';

const { auth, uploads } = vi.hoisted(() => ({
  auth: { member: null as unknown as CurrentMember, signOut: vi.fn(async () => {}) },
  uploads: { busy: false },
}));
vi.mock('@/auth/AuthProvider', () => ({
  useSignedInMember: () => auth.member,
  useAuth: () => ({ state: { status: 'signed-in', member: auth.member }, signOut: auth.signOut }),
}));
vi.mock('@/features/upload/FileUploadsProvider', () => ({
  useFileUploadsContext: () => uploads,
}));

beforeEach(() => {
  auth.signOut.mockClear();
  uploads.busy = false;
});

function renderSidebar(role: CurrentMember['role']) {
  auth.member = { id: 'u1', email: `${role}@example.com`, role };
  render(
    <MemoryRouter>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('AppSidebar', () => {
  it('shows admins how the system is running', () => {
    renderSidebar('admin');
    expect(screen.getByRole('link', { name: 'System status' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activity log' })).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('keeps members to uploads', () => {
    renderSidebar('member');
    expect(screen.getByRole('link', { name: 'Uploads' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'System status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Activity log' })).not.toBeInTheDocument();
  });

  it('says who is signed in, and signs them out', async () => {
    renderSidebar('member');
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('asks before signing out while files are still uploading', async () => {
    uploads.busy = true;
    renderSidebar('member');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: /Files are still uploading/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep uploading' }));
    expect(auth.signOut).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});
