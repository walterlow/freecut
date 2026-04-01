import { captureSnapshot, useTimelineCommandStore } from '@/features/editor/deps/timeline-store';
import type { Project } from '@/types/project';

type ProjectMetadataUpdates = {
  width?: number;
  height?: number;
  fps?: number;
  backgroundColor?: string;
};

interface CommitProjectMetadataChangeParams {
  project: Project;
  updates: ProjectMetadataUpdates;
  command: {
    type: string;
    payload?: Record<string, unknown>;
  };
  updateProject: (id: string, data: ProjectMetadataUpdates) => Promise<Project>;
  markDirty: () => void;
  onApplied?: (project: Project) => void;
}

function normalizeColor(value: string | undefined): string {
  return value ?? '#000000';
}

function hasProjectMetadataChanges(
  project: Project,
  updates: ProjectMetadataUpdates
): boolean {
  const metadata = project.metadata;

  return (updates.width !== undefined && updates.width !== metadata.width)
    || (updates.height !== undefined && updates.height !== metadata.height)
    || (updates.fps !== undefined && updates.fps !== metadata.fps)
    || (
      updates.backgroundColor !== undefined
      && normalizeColor(updates.backgroundColor) !== normalizeColor(metadata.backgroundColor)
    );
}

export async function commitProjectMetadataChange({
  project,
  updates,
  command,
  updateProject,
  markDirty,
  onApplied,
}: CommitProjectMetadataChangeParams): Promise<Project | null> {
  if (!hasProjectMetadataChanges(project, updates)) {
    return null;
  }

  const beforeSnapshot = captureSnapshot();
  const updatedProject = await updateProject(project.id, updates);
  onApplied?.(updatedProject);
  markDirty();
  useTimelineCommandStore.getState().addUndoEntry(command, beforeSnapshot);
  return updatedProject;
}
