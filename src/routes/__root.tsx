import { createRootRoute, Link, Outlet } from '@tanstack/react-router';

function RootErrorComponent({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 gap-4 text-center bg-background">
      <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
      <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      <Link
        to="/"
        className="text-sm font-medium text-primary hover:underline underline-offset-4"
      >
        Back to home
      </Link>
    </div>
  );
}

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
    </>
  ),
  errorComponent: RootErrorComponent,
});
