import { Link } from 'react-router';
import { HOME_PATH } from '@/routes';

/** Any address that isn't a route. Outside the app shell, so it's its own <main>. */
export function NotFoundPage() {
  return (
    <main className="grid min-h-svh place-content-center gap-2 p-6 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        There's nothing at this address.{' '}
        <Link to={HOME_PATH} className="font-semibold text-foreground underline underline-offset-4">
          Go to your uploads
        </Link>
      </p>
    </main>
  );
}
