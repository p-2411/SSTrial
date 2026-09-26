import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { createQueryClient } from '@/api/queryClient';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * A fresh QueryClient per test with the app's defaults, except that retries fire immediately so
 * error states appear fast.
 */
export function createTestQueryClient() {
  return createQueryClient({ retryDelay: 0, gcTime: Infinity });
}

export function Providers({ children, client, url = '/' }: { children: ReactNode; client: QueryClient; url?: string }) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** Renders inside React Query, tooltips and a router, as the app does. `url` sets the starting location, e.g. "/uploads/abc". */
export function renderWithProviders(ui: ReactElement, { client = createTestQueryClient(), url = '/' } = {}) {
  return { client, ...render(<Providers client={client} url={url}>{ui}</Providers>) };
}
