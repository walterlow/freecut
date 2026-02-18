import { createLogger } from '@/lib/logger';

const logger = createLogger('BlobUrlManager');

interface BlobUrlEntry {
  url: string;
  refCount: number;
}

/**
 * Centralized Blob URL manager with reference counting.
 *
 * Prevents memory leaks by:
 * - Reusing existing blob URLs for the same mediaId (no duplicate URLs)
 * - Reference counting so URLs are only revoked when no consumers remain
 * - Providing releaseAll() for project-level cleanup
 */
class BlobUrlManager {
  private entries = new Map<string, BlobUrlEntry>();

  /**
   * Acquire a blob URL for a media item.
   * If one already exists, increments the reference count and returns it.
   * Otherwise, creates a new blob URL from the provided blob.
   */
  acquire(mediaId: string, blob: Blob): string {
    const existing = this.entries.get(mediaId);
    if (existing) {
      existing.refCount++;
      return existing.url;
    }

    const url = URL.createObjectURL(blob);
    this.entries.set(mediaId, { url, refCount: 1 });
    return url;
  }

  /**
   * Get the cached blob URL for a media item without creating one.
   * Returns null if no URL exists for this mediaId.
   */
  get(mediaId: string): string | null {
    return this.entries.get(mediaId)?.url ?? null;
  }

  /**
   * Check if a blob URL exists for a media item.
   */
  has(mediaId: string): boolean {
    return this.entries.has(mediaId);
  }

  /**
   * Forcibly remove and revoke a blob URL regardless of reference count.
   * Used when the underlying media file has changed (e.g., after relinking).
   */
  invalidate(mediaId: string): void {
    const entry = this.entries.get(mediaId);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    this.entries.delete(mediaId);
  }

  /**
   * Release a reference to a blob URL.
   * Revokes the URL when the reference count reaches zero.
   */
  release(mediaId: string): void {
    const entry = this.entries.get(mediaId);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      URL.revokeObjectURL(entry.url);
      this.entries.delete(mediaId);
      logger.debug(`Revoked blob URL for media ${mediaId}`);
    }
  }

  /**
   * Release all blob URLs (e.g., on project cleanup).
   */
  releaseAll(): void {
    for (const [mediaId, entry] of this.entries) {
      URL.revokeObjectURL(entry.url);
      logger.debug(`Revoked blob URL for media ${mediaId}`);
    }
    this.entries.clear();
  }

  /**
   * Get the number of tracked blob URLs (for debugging).
   */
  get size(): number {
    return this.entries.size;
  }
}

/** Singleton instance for media blob URLs */
export const blobUrlManager = new BlobUrlManager();
