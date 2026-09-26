import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createTestQueryClient } from '@/test/render';
import { routes } from '../router';

const admin: CurrentMember = { id: 'u1', email: 'admin@example.com', role: 'admin' };
vi.mock('@/auth/AuthProvider', () => ({
  useSignedInMember: () => admin,
  useAuth: () => ({ state: { status: 'signed-in', member: admin }, signOut: async () => {} }),
}));
// No server to stream from.
vi.mock('@/api/useLiveUpdates', () => ({ useLiveUpdates: () => {} }));
// The System page's code loads, but the page fails as it renders.
vi.mock('@/features/system/loadSystemPage', () => ({
  loadSystemPage: async () => ({
    SystemPage: () => {
      throw new Error('Cannot read properties of undefined');
    },
  }),
}));

beforeEach(() => {
  // React and the router report the caught error; that's expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('RouteError', () => {
  it('takes the place of a page that fails, inside the app shell, so the sidebar stays', async () => {
    renderAt('/system');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This page couldn't be shown");
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to your uploads' })).toHaveAttribute('href', '/');
    // Nothing technical reaches the person.
    expect(alert).not.toHaveTextContent('Cannot read properties');
    // Still in the app: its sidebar and top bar are there.
    expect(screen.getByRole('link', { name: 'Uploads' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'System' })).toBeVisible();
  });

  it("says an address that isn't a page isn't found", async () => {
    renderAt('/nowhere');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
