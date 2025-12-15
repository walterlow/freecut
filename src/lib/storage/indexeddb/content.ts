import type { ContentRecord, MediaMetadata } from '@/types/storage';
import { getDB } from './connection';
import { createLogger } from '@/lib/logger';

const logger = createLogger('IndexedDB:Content');

/**
 * Get content record by hash.
 */
export async function getContentByHash(
  hash: string
): Promise<ContentRecord | undefined> {
  try {
    const db = await getDB();
    return await db.get('content', hash);
  } catch (error) {
    logger.error(`Failed to get content ${hash}:`, error);
    throw new Error(`Failed to load content: ${hash}`);
  }
}

/**
 * Check if any content exists with the given file size.
 * Used for fast deduplication check - if no size match, can't be a duplicate.
 */
export async function hasContentWithSize(fileSize: number): Promise<boolean> {
  try {
    const db = await getDB();
    const allContent = await db.getAll('content');
    return allContent.some((content) => content.fileSize === fileSize);
  } catch (error) {
    logger.error('Failed to check content by size:', error);
    return false;
  }
}

/**
 * Create a new content record, or increment ref count if it already exists.
 * Handles race conditions from concurrent uploads of the same file.
 */
export async function createContent(record: ContentRecord): Promise<void> {
  try {
    const db = await getDB();
    const existing = await db.get('content', record.hash);

    if (existing) {
      await db.put('content', {
        ...existing,
        referenceCount: existing.referenceCount + 1,
      });
    } else {
      await db.add('content', record);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ConstraintError') {
      const db = await getDB();
      const existing = await db.get('content', record.hash);
      if (existing) {
        await db.put('content', {
          ...existing,
          referenceCount: existing.referenceCount + 1,
        });
        return;
      }
    }
    logger.error('Failed to create content record:', error);
    throw error;
  }
}

/**
 * Increment reference count for content.
 * Returns the new reference count.
 */
export async function incrementContentRef(hash: string): Promise<number> {
  try {
    const db = await getDB();
    const existing = await db.get('content', hash);

    if (!existing) {
      throw new Error(`Content not found: ${hash}`);
    }

    const updated: ContentRecord = {
      ...existing,
      referenceCount: existing.referenceCount + 1,
    };

    await db.put('content', updated);
    return updated.referenceCount;
  } catch (error) {
    logger.error(`Failed to increment content ref ${hash}:`, error);
    throw error;
  }
}

/**
 * Decrement reference count for content.
 * Returns the new reference count.
 */
export async function decrementContentRef(hash: string): Promise<number> {
  try {
    const db = await getDB();
    const existing = await db.get('content', hash);

    if (!existing) {
      throw new Error(`Content not found: ${hash}`);
    }

    const updated: ContentRecord = {
      ...existing,
      referenceCount: Math.max(0, existing.referenceCount - 1),
    };

    await db.put('content', updated);
    return updated.referenceCount;
  } catch (error) {
    logger.error(`Failed to decrement content ref ${hash}:`, error);
    throw error;
  }
}

/**
 * Delete a content record.
 */
export async function deleteContent(hash: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('content', hash);
  } catch (error) {
    logger.error(`Failed to delete content ${hash}:`, error);
    throw new Error(`Failed to delete content: ${hash}`);
  }
}

/**
 * Find media by content hash.
 */
export async function findMediaByContentHash(
  hash: string
): Promise<MediaMetadata | undefined> {
  try {
    const db = await getDB();
    const tx = db.transaction('media', 'readonly');
    const index = tx.store.index('contentHash');
    const results = await index.getAll(hash);
    return results[0];
  } catch (error) {
    logger.error(`Failed to find media by hash ${hash}:`, error);
    return undefined;
  }
}
