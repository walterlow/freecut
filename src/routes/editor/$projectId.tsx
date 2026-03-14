import { createFileRoute } from '@tanstack/react-router';
import { getProject } from '@/infrastructure/storage/indexeddb';

export const Route = createFileRoute('/editor/$projectId')({
  loader: async ({ params }) => {
    // Validate project exists - actual loading happens in Editor via loadTimeline
    const project = await getProject(params.projectId);

    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }

    // Only pass metadata needed for Editor initialization (not timeline data)
    return {
      project: {
        id: project.id,
        name: project.name,
        width: project.metadata.width,
        height: project.metadata.height,
        fps: project.metadata.fps,
        backgroundColor: project.metadata.backgroundColor,
      },
    };
  },
});

