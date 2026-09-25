import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/** A fresh QueryClient per test, with retries that fire immediately so error states appear fast. */
export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
}

export function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, client = createTestQueryClient()) {
  return { client, ...render(<Providers client={client}>{ui}</Providers>) };
}

/** A JSON Response, as fetch would return it. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
