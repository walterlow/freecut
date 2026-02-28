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
