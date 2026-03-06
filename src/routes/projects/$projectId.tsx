import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/projects/$projectId')({
  beforeLoad: ({ params }) => {
    // Redirect to the editor — project settings are handled via the edit dialog on /projects/
    // Wallet is checked only at the destination (/editor/$projectId).
    throw redirect({ to: '/editor/$projectId', params: { projectId: params.projectId } });
  },
  component: () => null,
});
