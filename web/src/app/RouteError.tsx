import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { InlineError } from '@/components/InlineError';
import { cn } from '@/lib/utils';
import { HOME_PATH } from '@/routes';
import { NotFoundPage } from './NotFoundPage';

/**
 * What a route shows when its page fails to render, or its code can't be loaded (see
 * importWithReload), in place of React Router's stack trace: a calm message with Reload and a way
 * home. Nothing technical: the error itself goes to the console.
 *
 * On a page inside the app shell it takes the page's place, so the sidebar stays. `standalone`, it
 * is the whole page (sign-in, or the shell itself failing). An address with no page is "not found".
 */
export function RouteError({ standalone = false }: { standalone?: boolean }) {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage standalone={standalone} />;

  const Page = standalone ? 'main' : 'div';
  return (
    <Page className={cn('grid place-content-center p-6', standalone ? 'min-h-svh' : 'min-h-0 flex-1')}>
      <div className="w-md max-w-full">
        <InlineError
          title="This page couldn't be shown"
          message="Something went wrong. Reload to try again, or go back to your uploads."
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
        >
          <Link to={HOME_PATH} reloadDocument className="text-sm font-semibold text-foreground underline underline-offset-4">
            Go to your uploads
          </Link>
        </InlineError>
      </div>
    </Page>
  );
}
