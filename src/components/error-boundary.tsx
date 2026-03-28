import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('ErrorBoundary');

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level?: 'app' | 'feature' | 'component';
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console in development
    if (import.meta.env.DEV) {
      logger.error('ErrorBoundary caught:', error, errorInfo);
    }

    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { level = 'component' } = this.props;

      return (
        <div className="flex flex-col items-center justify-center p-8 gap-4 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <div>
            <h2 className="text-lg font-semibold">
              {level === 'app' && 'Application Error'}
              {level === 'feature' && 'Something went wrong'}
              {level === 'component' && 'Component Error'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={this.handleReset} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            {level === 'app' && (
              <Button onClick={() => window.location.reload()}>
                Reload Page
              </Button>
            )}
          </div>
          {import.meta.env.DEV && this.state.error?.stack && (
            <pre className="mt-4 p-4 bg-muted rounded text-xs text-left overflow-auto max-w-full max-h-48">
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
