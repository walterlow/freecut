import {
  associateMediaWithProject,
  createProject,
  deleteProject,
  getProject,
  getProjectMediaIds,
  getThumbnail,
  removeMediaFromProject,
  saveThumbnail,
  updateProject,
} from '@/infrastructure/storage/indexeddb';
import { createLogger } from '@/shared/logging/logger';
import type { Project } from '@/types/project';
import {
  duplicateProject,
  formatProjectUpgradeBackupName,
} from '../utils/project-helpers';

const logger = createLogger('ProjectUpgradeService');

interface CreateProjectUpgradeBackupOptions {
  backupName?: string;
  fromVersion: number;
  toVersion: number;
}

/**
 * Create a restorable backup of a project before running a schema upgrade.
 *
 * The backup remains on the legacy schema version and keeps the original
 * project media associations so it can still be opened independently later.
 */
export async function createProjectUpgradeBackup(
  projectId: string,
  options: CreateProjectUpgradeBackupOptions
): Promise<Project> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const backup = duplicateProject(project);
  backup.name = options.backupName
    ?? formatProjectUpgradeBackupName(project.name, options.fromVersion, options.toVersion);
  backup.thumbnailId = undefined;

  await createProject(backup);

  const associatedMediaIds: string[] = [];
  try {
    const mediaIds = await getProjectMediaIds(projectId);
    for (const mediaId of mediaIds) {
      await associateMediaWithProject(backup.id, mediaId);
      associatedMediaIds.push(mediaId);
    }
  } catch (error) {
    for (const mediaId of associatedMediaIds) {
      try {
        await removeMediaFromProject(backup.id, mediaId);
      } catch (cleanupError) {
        logger.warn(`Failed to remove backup media association ${mediaId} during rollback`, cleanupError);
      }
    }

    try {
      await deleteProject(backup.id);
    } catch (cleanupError) {
      logger.warn(`Failed to roll back backup project ${backup.id}`, cleanupError);
    }

    throw error;
  }

  if (!project.thumbnailId) {
    return backup;
  }

  try {
    const thumbnail = await getThumbnail(project.thumbnailId);
    if (!thumbnail) {
      return backup;
    }

    const backupThumbnailId = `project:${backup.id}:cover`;
    await saveThumbnail({
      ...thumbnail,
      id: backupThumbnailId,
      mediaId: backup.id,
      timestamp: Date.now(),
    });

    await updateProject(backup.id, {
      thumbnailId: backupThumbnailId,
      thumbnail: undefined,
    });

    return {
      ...backup,
      thumbnailId: backupThumbnailId,
      thumbnail: undefined,
    };
  } catch (error) {
    logger.warn(`Failed to copy thumbnail for backup project ${backup.id}`, error);
    return backup;
  }
}
