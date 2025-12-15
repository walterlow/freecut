import type { FilmstripData } from '@/types/storage';
import { getDB, reconnectDB } from './connection';
import { createLogger } from '@/lib/logger';

const logger = createLogger('IndexedDB:Filmstrips');

/**
 * Save filmstrip data to IndexedDB.
 */
export async function saveFilmstrip(filmstrip: FilmstripData): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('filmstrips')) {
      logger.warn('filmstrips store not found, attempting reconnection...');
      db = await reconnectDB();
    }
    await db.put('filmstrips', filmstrip);
  } catch (error) {
    logger.error('Failed to save filmstrip:', error);
    throw new Error('Failed to save filmstrip');
  }
}

/**
 * Get filmstrip by ID (mediaId:density).
 */
export async function getFilmstrip(
  id: string
): Promise<FilmstripData | undefined> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('filmstrips')) {
      logger.warn('filmstrips store not found, attempting reconnection...');
      const newDb = await reconnectDB();
      if (!newDb.objectStoreNames.contains('filmstrips')) {
        throw new Error('filmstrips store not found after reconnection');
      }
      return await newDb.get('filmstrips', id);
    }
    return await db.get('filmstrips', id);
  } catch (error) {
    logger.error(`Failed to get filmstrip ${id}:`, error);
    return undefined;
  }
}

/**
 * Get filmstrip by media ID and density.
 */
export async function getFilmstripByMediaAndDensity(
  mediaId: string,
  density: string
): Promise<FilmstripData | undefined> {
  const id = `${mediaId}:${density}`;
  return getFilmstrip(id);
}

/**
 * Get filmstrip by media ID (returns first/only filmstrip for the media).
 */
export async function getFilmstripByMediaId(
  mediaId: string
): Promise<FilmstripData | undefined> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('filmstrips')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return undefined;
      }
    }
    const tx = db.transaction('filmstrips', 'readonly');
    const index = tx.store.index('mediaId');
    const results = await index.getAll(mediaId);
    return results[0];
  } catch (error) {
    logger.error(`Failed to get filmstrip for media ${mediaId}:`, error);
    return undefined;
  }
}

/**
 * Get all filmstrips for a media item.
 */
export async function getFilmstripsByMediaId(
  mediaId: string
): Promise<FilmstripData[]> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('filmstrips')) {
      logger.warn('filmstrips store not found, attempting reconnection...');
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return [];
      }
    }
    const tx = db.transaction('filmstrips', 'readonly');
    const index = tx.store.index('mediaId');
    return await index.getAll(mediaId);
  } catch (error) {
    logger.error(`Failed to get filmstrips for media ${mediaId}:`, error);
    return [];
  }
}

/**
 * Delete filmstrip by ID.
 */
export async function deleteFilmstrip(id: string): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('filmstrips')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return;
      }
    }
    await db.delete('filmstrips', id);
  } catch (error) {
    logger.error(`Failed to delete filmstrip ${id}:`, error);
    throw new Error(`Failed to delete filmstrip: ${id}`);
  }
}

/**
 * Delete all filmstrips for a media item.
 */
export async function deleteFilmstripsByMediaId(mediaId: string): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('filmstrips')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('filmstrips')) {
        return;
      }
    }
    const tx = db.transaction('filmstrips', 'readwrite');
    const index = tx.store.index('mediaId');
    const filmstrips = await index.getAll(mediaId);

    for (const filmstrip of filmstrips) {
      await tx.store.delete(filmstrip.id);
    }

    await tx.done;
  } catch (error) {
    logger.error(`Failed to delete filmstrips for media ${mediaId}:`, error);
    throw new Error('Failed to delete filmstrips');
  }
}
