import { createLazyFileRoute } from '@tanstack/react-router';
import { Editor } from '@/features/editor/components/editor';

export const Route = createLazyFileRoute('/editor/$projectId')({
  component: EditorPage,
});

function EditorPage() {
  const { projectId } = Route.useParams();
  const { project } = Route.useLoaderData();

  return <Editor projectId={projectId} project={project} />;
}
