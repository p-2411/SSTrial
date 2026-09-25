import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';

const { auth } = vi.hoisted(() => ({
  auth: { member: null as unknown as CurrentMember, signOut: vi.fn(async () => {}) },
}));
vi.mock('@/auth/AuthProvider', () => ({
  useSignedInMember: () => auth.member,
  useAuth: () => ({ signOut: auth.signOut }),
}));

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
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});
