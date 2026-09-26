import { useState, type SubmitEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ScanText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { HOME_PATH } from '@/routes';
import { useAuth } from './AuthProvider';

/** Email and password, in the SupplyScope card style. Outside the app shell, so it's its own <main>. */
export function SignInPage() {
  const { state, signIn } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (state.status === 'signed-in') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? HOME_PATH} replace />;
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(await signIn(String(form.get('email')), String(form.get('password'))));
    setPending(false);
  }

  const message = error ?? (state.status === 'signed-out' ? state.notice : null);
  return (
    <main className="grid min-h-svh place-content-center bg-background p-6">
      <Card className="w-96">
        <CardHeader className="gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-sidebar text-white">
            <ScanText className="size-4.5" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">Sign in</h1>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-4" onSubmit={onSubmit}>
            <label className="grid grid-cols-1 gap-1.5 text-sm font-medium">
              Email
              <Input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="grid grid-cols-1 gap-1.5 text-sm font-medium">
              Password
              <Input name="password" type="password" autoComplete="current-password" required />
            </label>
            {message && (
              <p role="alert" className="text-sm text-danger">
                {message}
              </p>
            )}
            <Button type="submit" loading={pending} disabled={state.status === 'loading'}>
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
