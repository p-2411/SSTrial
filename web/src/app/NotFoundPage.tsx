import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { HOME_PATH } from '@/routes';

/**
 * Any address that isn't a route. On its own, outside the app shell, it's its own <main>; inside the
 * shell (`standalone={false}`) it takes the page's place under the top bar.
 */
export function NotFoundPage({ standalone = true }: { standalone?: boolean }) {
  const Page = standalone ? 'main' : 'div';
  return (
    <Page className={cn('grid place-content-center gap-2 p-6 text-center', standalone ? 'min-h-svh' : 'min-h-0 flex-1')}>
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        There's nothing at this address.{' '}
        <Link to={HOME_PATH} className="font-semibold text-foreground underline underline-offset-4">
          Go to your uploads
        </Link>
      </p>
    </Page>
  );
}
