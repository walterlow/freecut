import type { MediaMetadata } from '@/types/storage';
import { getDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:Media');

/**
 * Get all media items from IndexedDB.
 */
export async function getAllMedia(): Promise<MediaMetadata[]> {
  try {
    const db = await getDB();
    return await db.getAll('media');
  } catch (error) {
    logger.error('Failed to get all media:', error);
    throw new Error('Failed to load media from database');
  }
}

/**
 * Get a single media item by ID.
 */
export async function getMedia(id: string): Promise<MediaMetadata | undefined> {
  try {
    const db = await getDB();
    return await db.get('media', id);
  } catch (error) {
    logger.error(`Failed to get media ${id}:`, error);
    throw new Error(`Failed to load media: ${id}`);
  }
}

/**
 * Create a new media item in IndexedDB.
 */
export async function createMedia(media: MediaMetadata): Promise<MediaMetadata> {
  try {
    const db = await getDB();
    await db.add('media', media);
    return media;
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      throw new Error(
        'Storage quota exceeded. Please delete some media to free up space.'
      );
    }
    logger.error('Failed to create media:', error);
    throw error;
  }
}

/**
 * Update an existing media item in IndexedDB.
 */
export async function updateMedia(
  id: string,
  updates: Partial<MediaMetadata>
): Promise<MediaMetadata> {
  try {
    const db = await getDB();
    const existing = await db.get('media', id);

    if (!existing) {
      throw new Error(`Media not found: ${id}`);
    }

    const updated: MediaMetadata = {
      ...existing,
      ...updates,
      id,
      updatedAt: Date.now(),
    };

    await db.put('media', updated);
    return updated;
  } catch (error) {
    logger.error(`Failed to update media ${id}:`, error);
    throw error;
  }
}

/**
 * Delete a media item from IndexedDB.
 */
export async function deleteMedia(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('media', id);
  } catch (error) {
    logger.error(`Failed to delete media ${id}:`, error);
    throw new Error(`Failed to delete media: ${id}`);
  }
}
