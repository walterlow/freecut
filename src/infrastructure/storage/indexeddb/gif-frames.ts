import type { GifFrameData } from '@/types/storage';
import { getDB, reconnectDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:GifFrames');

/**
 * Save GIF frame data to IndexedDB.
 */
export async function saveGifFrames(gifFrameData: GifFrameData): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('gifFrames')) {
      logger.warn('gifFrames store not found, attempting reconnection...');
      db = await reconnectDB();
    }
    await db.put('gifFrames', gifFrameData);
  } catch (error) {
    logger.error('Failed to save GIF frames:', error);
    throw new Error('Failed to save GIF frames');
  }
}

/**
 * Get GIF frames by ID (mediaId).
 */
export async function getGifFrames(
  id: string
): Promise<GifFrameData | undefined> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('gifFrames')) {
      logger.warn('gifFrames store not found, attempting reconnection...');
      const newDb = await reconnectDB();
      if (!newDb.objectStoreNames.contains('gifFrames')) {
        throw new Error('gifFrames store not found after reconnection');
      }
      return await newDb.get('gifFrames', id);
    }
    return await db.get('gifFrames', id);
  } catch (error) {
    logger.error(`Failed to get GIF frames ${id}:`, error);
    return undefined;
  }
}

/**
 * Delete GIF frames by ID (mediaId).
 */
export async function deleteGifFrames(id: string): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('gifFrames')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('gifFrames')) {
        return;
      }
    }
    await db.delete('gifFrames', id);
  } catch (error) {
    logger.error(`Failed to delete GIF frames ${id}:`, error);
    throw new Error(`Failed to delete GIF frames: ${id}`);
  }
}

/**
 * Clear all GIF frame data from IndexedDB.
 * Used for debugging and cache invalidation.
 */
export async function clearAllGifFrames(): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('gifFrames')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('gifFrames')) {
        return;
      }
    }
    await db.clear('gifFrames');
    logger.debug('[IndexedDB] Cleared all GIF frames');
  } catch (error) {
    logger.error('Failed to clear GIF frames:', error);
    throw new Error('Failed to clear GIF frames');
  }
}
