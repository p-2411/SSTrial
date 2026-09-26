import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Shown in place of the children once they've failed to render. `reset` tries them again. */
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
}

/**
 * Keeps one part of a page failing to render from taking the page with it: that part shows
 * `fallback`, and everything around it carries on. Give it a `key` to start afresh when what it
 * shows changes (another upload, say). Route-level failures are the router's (see RouteError).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  reset = () => this.setState({ failed: false });

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
