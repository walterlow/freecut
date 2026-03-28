import { createLazyFileRoute } from '@tanstack/react-router';
import { Editor } from '@/features/editor/components/editor';
import { RequireWallet } from '@/components/require-wallet';

export const Route = createLazyFileRoute('/editor/$projectId')({
  component: EditorPage,
});

function EditorPage() {
  const { projectId } = Route.useParams();
  const { project } = Route.useLoaderData();

  return (
    <RequireWallet>
      <Editor projectId={projectId} project={project} />
    </RequireWallet>
  );
}
