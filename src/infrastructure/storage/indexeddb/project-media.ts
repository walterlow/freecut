import type { MediaMetadata, ProjectMediaAssociation } from '@/types/storage';
import { getDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:ProjectMedia');

/**
 * Associate media with a project.
 */
export async function associateMediaWithProject(
  projectId: string,
  mediaId: string
): Promise<void> {
  try {
    const db = await getDB();
    const association: ProjectMediaAssociation = {
      projectId,
      mediaId,
      addedAt: Date.now(),
    };
    await db.put('projectMedia', association);
  } catch (error) {
    logger.error(
      `Failed to associate media ${mediaId} with project ${projectId}:`,
      error
    );
    throw error;
  }
}

/**
 * Remove media association from a project.
 */
export async function removeMediaFromProject(
  projectId: string,
  mediaId: string
): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('projectMedia', [projectId, mediaId]);
  } catch (error) {
    logger.error(
      `Failed to remove media ${mediaId} from project ${projectId}:`,
      error
    );
    throw error;
  }
}

/**
 * Get all media IDs associated with a project.
 */
export async function getProjectMediaIds(projectId: string): Promise<string[]> {
  try {
    const db = await getDB();
    const tx = db.transaction('projectMedia', 'readonly');
    const index = tx.store.index('projectId');
    const associations = await index.getAll(projectId);
    return associations.map((a) => a.mediaId);
  } catch (error) {
    logger.error(`Failed to get media for project ${projectId}:`, error);
    throw new Error(`Failed to get project media: ${projectId}`);
  }
}

/**
 * Get all project IDs that use a specific media item.
 */
export async function getProjectsUsingMedia(mediaId: string): Promise<string[]> {
  try {
    const db = await getDB();
    const tx = db.transaction('projectMedia', 'readonly');
    const index = tx.store.index('mediaId');
    const associations = await index.getAll(mediaId);
    return associations.map((a) => a.projectId);
  } catch (error) {
    logger.error(`Failed to get projects using media ${mediaId}:`, error);
    throw new Error(`Failed to get projects for media: ${mediaId}`);
  }
}

/**
 * Get all media metadata for a project.
 * Also cleans up orphaned projectMedia entries where the media no longer exists.
 */
export async function getMediaForProject(
  projectId: string
): Promise<MediaMetadata[]> {
  try {
    const mediaIds = await getProjectMediaIds(projectId);
    const db = await getDB();

    const media: MediaMetadata[] = [];
    const orphanedIds: string[] = [];

    for (const id of mediaIds) {
      const item = await db.get('media', id);
      if (item) {
        media.push(item);
      } else {
        orphanedIds.push(id);
      }
    }

    if (orphanedIds.length > 0) {
      logger.warn(
        `Cleaning up ${orphanedIds.length} orphaned projectMedia entries for project ${projectId}`
      );
      for (const mediaId of orphanedIds) {
        try {
          await db.delete('projectMedia', [projectId, mediaId]);
        } catch (error) {
          logger.warn(
            `Failed to clean up orphaned entry for media ${mediaId}:`,
            error
          );
        }
      }
    }

    return media;
  } catch (error) {
    logger.error(`Failed to get media for project ${projectId}:`, error);
    throw new Error(`Failed to load project media: ${projectId}`);
  }
}
