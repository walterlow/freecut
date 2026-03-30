import { createFileRoute } from '@tanstack/react-router';
import { CURRENT_SCHEMA_VERSION } from '@/domain/projects/migrations';
import { getProject } from '@/infrastructure/storage/indexeddb';

export const Route = createFileRoute('/editor/$projectId')({
  // Editor loader data is tiny and migration state must be fresh on reopen.
  // Avoid keeping inactive editor matches around with stale "requires upgrade" flags.
  gcTime: 0,
  preloadGcTime: 0,
  loader: async ({ params }) => {
    // Validate project exists - actual loading happens in Editor via loadTimeline
    const project = await getProject(params.projectId);

    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }

    const storedSchemaVersion = project.schemaVersion ?? 1;

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
      migration: {
        storedSchemaVersion,
        currentSchemaVersion: CURRENT_SCHEMA_VERSION,
        requiresUpgrade: storedSchemaVersion < CURRENT_SCHEMA_VERSION,
      },
    };
  },
});
