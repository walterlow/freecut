import type { ContentRecord } from '@/types/storage';
import { getDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:Content');

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
 * Create a new content record (e.g. when first uploading to OPFS).
 * Use referenceCount: 1 for the initial media reference.
 */
export async function createContentRecord(
  hash: string,
  fileSize: number,
  mimeType: string
): Promise<void> {
  try {
    const db = await getDB();
    const record: ContentRecord = {
      hash,
      fileSize,
      mimeType,
      referenceCount: 1,
      createdAt: Date.now(),
    };
    await db.put('content', record);
  } catch (error) {
    logger.error(`Failed to create content record ${hash}:`, error);
    throw error;
  }
}

/**
 * Ensure a content record exists and has its ref count incremented for a new media reference.
 * If the record does not exist, creates it with referenceCount: 1.
 * If it exists, increments referenceCount.
 */
export async function ensureContentRecordAndIncrement(
  hash: string,
  fileSize: number,
  mimeType: string
): Promise<void> {
  try {
    const db = await getDB();
    const existing = await db.get('content', hash);

    if (existing) {
      const updated: ContentRecord = {
        ...existing,
        referenceCount: existing.referenceCount + 1,
      };
      await db.put('content', updated);
    } else {
      const record: ContentRecord = {
        hash,
        fileSize,
        mimeType,
        referenceCount: 1,
        createdAt: Date.now(),
      };
      await db.put('content', record);
    }
  } catch (error) {
    logger.error(`Failed to ensure content record ${hash}:`, error);
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
