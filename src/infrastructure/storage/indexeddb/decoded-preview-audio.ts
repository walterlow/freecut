import type { DecodedPreviewAudio } from '@/types/storage';
import { getDB, reconnectDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:DecodedPreviewAudio');

async function getStore() {
  let db = await getDB();
  if (!db.objectStoreNames.contains('decodedPreviewAudio')) {
    logger.warn('decodedPreviewAudio store not found, attempting reconnection...');
    db = await reconnectDB();
    if (!db.objectStoreNames.contains('decodedPreviewAudio')) {
      throw new Error('decodedPreviewAudio store not found after reconnection');
    }
  }
  return db;
}

/**
 * Get a record by primary key (mediaId for meta, `${mediaId}:bin:${index}` for bins).
 */
export async function getDecodedPreviewAudio(
  id: string
): Promise<DecodedPreviewAudio | undefined> {
  try {
    const db = await getStore();
    return await db.get('decodedPreviewAudio', id);
  } catch (error) {
    logger.error(`Failed to get decoded preview audio ${id}:`, error);
    return undefined;
  }
}

/**
 * Save a meta or bin record.
 */
export async function saveDecodedPreviewAudio(
  data: DecodedPreviewAudio
): Promise<void> {
  const db = await getStore();
  try {
    await db.put('decodedPreviewAudio', data);
  } catch (error) {
    logger.error(`Failed to save decoded preview audio ${data.id}:`, error);
    throw error;
  }
}

/**
 * Delete all records (meta + bins) for a given mediaId.
 * Uses the mediaId index to find all matching records.
 */
export async function deleteDecodedPreviewAudio(mediaId: string): Promise<void> {
  try {
    const db = await getStore();
    const tx = db.transaction('decodedPreviewAudio', 'readwrite');

    // Remove the meta key directly in case older records are missing mediaId.
    await tx.store.delete(mediaId);

    const index = tx.store.index('mediaId');
    let cursor = await index.openCursor(mediaId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    logger.error(`Failed to delete decoded preview audio ${mediaId}:`, error);
  }
}
