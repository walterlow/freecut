import { useSyncExternalStore } from 'react';
import { createLogger } from '@/shared/logging/logger';

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
  private version = 0;
  private listeners = new Set<() => void>();

  /** Notify React subscribers that blob URLs have changed */
  private notify(): void {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Subscribe to changes (for useSyncExternalStore) */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Get current version snapshot (for useSyncExternalStore) */
  getSnapshot = (): number => this.version;

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
    this.notify();
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
    this.notify();
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
      this.notify();
      logger.debug(`Revoked blob URL for media ${mediaId}`);
    }
  }

  /**
   * Revoke and remove all blob URLs regardless of reference count.
   * Used on tab wake-up to recover from stale blob URLs after inactivity.
   * Consumers will re-acquire fresh URLs on next resolve.
   */
  invalidateAll(): void {
    for (const entry of this.entries.values()) {
      URL.revokeObjectURL(entry.url);
    }
    this.entries.clear();
    this.notify();
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
    this.notify();
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

/**
 * React hook that re-renders when blob URLs are acquired or released.
 * Use as a dependency in useMemo to react to URL availability changes.
 */
export function useBlobUrlVersion(): number {
  return useSyncExternalStore(blobUrlManager.subscribe, blobUrlManager.getSnapshot);
}
