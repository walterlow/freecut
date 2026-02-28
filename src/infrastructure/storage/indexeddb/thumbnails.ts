import type { ThumbnailData } from '@/types/storage';
import { getDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:Thumbnails');

/**
 * Save a thumbnail to IndexedDB.
 */
export async function saveThumbnail(thumbnail: ThumbnailData): Promise<void> {
  try {
    const db = await getDB();
    await db.put('thumbnails', thumbnail);
  } catch (error) {
    logger.error('Failed to save thumbnail:', error);
    throw new Error('Failed to save thumbnail');
  }
}

/**
 * Get a thumbnail by ID.
 */
export async function getThumbnail(
  id: string
): Promise<ThumbnailData | undefined> {
  try {
    const db = await getDB();
    return await db.get('thumbnails', id);
  } catch (error) {
    logger.error(`Failed to get thumbnail ${id}:`, error);
    throw new Error(`Failed to load thumbnail: ${id}`);
  }
}

/**
 * Get a thumbnail by media ID.
 */
export async function getThumbnailByMediaId(
  mediaId: string
): Promise<ThumbnailData | undefined> {
  try {
    const db = await getDB();
    const tx = db.transaction('thumbnails', 'readonly');
    const index = tx.store.index('mediaId');
    const thumbnails = await index.getAll(mediaId);

    return thumbnails[0];
  } catch (error) {
    logger.error(`Failed to get thumbnail for media ${mediaId}:`, error);
    return undefined;
  }
}

/**
 * Delete thumbnails by media ID.
 */
export async function deleteThumbnailsByMediaId(mediaId: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction('thumbnails', 'readwrite');
    const index = tx.store.index('mediaId');
    const thumbnails = await index.getAll(mediaId);

    for (const thumbnail of thumbnails) {
      await tx.store.delete(thumbnail.id);
    }

    await tx.done;
  } catch (error) {
    logger.error(`Failed to delete thumbnails for media ${mediaId}:`, error);
    throw new Error('Failed to delete thumbnails');
  }
}
