/**
 * Filmstrip Cache Service
 *
 * Manages filmstrip thumbnail caching with:
 * - In-memory LRU cache for fast access
 * - Hardware-accelerated frame extraction via 4 parallel workers (WebCodecs)
 * - Fixed frame density for consistent quality
 * - Progressive streaming of thumbnails
 * - Rendering matches frames to display slots by timestamp
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('FilmstripCache');

import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from '@/features/timeline/constants';
import { filmstripWorkerPool } from './filmstrip-worker-pool';
import { filmstripOPFSStorage } from './filmstrip-opfs-storage';
// Legacy IndexedDB imports for migration
import {
  deleteFilmstripsByMediaId as deleteFromIndexedDB,
  getFilmstripByMediaId as getFromIndexedDB,
} from '@/lib/storage/indexeddb';

// Re-export for consumers that import from this file
export { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT };
const JPEG_QUALITY = 0.7;

// Memory cache configuration
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

// Progressive loading: frames per update batch
// Lower value = more immediate frame appearance, but more frequent updates
const FRAMES_PER_BATCH = 3;

export interface CachedFilmstrip {
  frames: ImageBitmap[];
  blobs: Blob[]; // Keep blobs for IndexedDB persistence
  timestamps: number[];
  width: number;
  height: number;
  sizeBytes: number;
  lastAccessed: number;
  isComplete: boolean;
}

interface PendingRequest {
  promise: Promise<CachedFilmstrip>;
  requestId: string; // Worker pool request ID for abort
}

export type FilmstripUpdateCallback = (filmstrip: CachedFilmstrip) => void;

class FilmstripCacheService {
  private memoryCache = new Map<string, CachedFilmstrip>();
  private currentCacheSize = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private updateCallbacks = new Map<string, Set<FilmstripUpdateCallback>>();

  /**
   * Subscribe to filmstrip updates for progressive loading
   */
  subscribe(mediaId: string, callback: FilmstripUpdateCallback): () => void {
    if (!this.updateCallbacks.has(mediaId)) {
      this.updateCallbacks.set(mediaId, new Set());
    }
    this.updateCallbacks.get(mediaId)!.add(callback);
    return () => {
      const callbacks = this.updateCallbacks.get(mediaId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.updateCallbacks.delete(mediaId);
        }
      }
    };
  }

  /**
   * Notify subscribers of filmstrip updates
   */
  private notifyUpdate(mediaId: string, filmstrip: CachedFilmstrip): void {
    const callbacks = this.updateCallbacks.get(mediaId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(filmstrip);
      }
    }
  }

  /**
   * Get filmstrip from memory cache (private)
   */
  private getFromMemoryCache(mediaId: string): CachedFilmstrip | null {
    const cached = this.memoryCache.get(mediaId);

    if (cached) {
      // Update last accessed time
      cached.lastAccessed = Date.now();
      return cached;
    }

    return null;
  }

  /**
   * Check if filmstrip exists in memory cache (synchronous)
   * Used to avoid skeleton flash when component remounts
   */
  getFromMemoryCacheSync(mediaId: string): CachedFilmstrip | null {
    return this.getFromMemoryCache(mediaId);
  }

  /**
   * Add filmstrip to memory cache with LRU eviction
   */
  private addToMemoryCache(mediaId: string, data: CachedFilmstrip): void {
    // Check if we're updating an existing entry
    const existing = this.memoryCache.get(mediaId);
    if (existing) {
      this.currentCacheSize -= existing.sizeBytes;
    }

    // Evict old entries if necessary
    while (this.currentCacheSize + data.sizeBytes > MAX_CACHE_SIZE_BYTES && this.memoryCache.size > 0) {
      this.evictOldest();
    }

    // Add to cache
    this.memoryCache.set(mediaId, data);
    this.currentCacheSize += data.sizeBytes;
  }

  /**
   * Evict the oldest (least recently accessed) entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.memoryCache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.memoryCache.get(oldestKey);
      if (entry) {
        // Close ImageBitmaps to free GPU memory
        for (const bitmap of entry.frames) {
          bitmap.close();
        }
        this.currentCacheSize -= entry.sizeBytes;
        this.memoryCache.delete(oldestKey);
      }
    }
  }

  /**
   * Binary search to find insertion index for sorted timestamp array
   */
  private binarySearchInsert(timestamps: number[], timestamp: number): number {
    let left = 0;
    let right = timestamps.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (timestamps[mid]! < timestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  /**
   * Generate filmstrip using 4 parallel workers (hardware-accelerated WebCodecs)
   * Uses CanvasSink.canvasesAtTimestamps() for sparse extraction (only decodes needed frames)
   */
  private generateFilmstrip(
    mediaId: string,
    blobUrl: string,
    duration: number,
    onProgress?: (progress: number) => void
  ): { promise: Promise<CachedFilmstrip>; requestId: string } {
    // Track frames and timestamps (will be inserted in sorted order)
    const frames: ImageBitmap[] = [];
    const timestamps: number[] = [];

    // Expected frame count at 24 fps for progress calculation
    const expectedFrames = Math.ceil(duration * 24);
    let receivedFrames = 0;
    let lastUpdateCount = 0;

    const promise = new Promise<CachedFilmstrip>((resolve, reject) => {
      const requestId = filmstripWorkerPool.extract({
        mediaId,
        blobUrl,
        duration,

        onFrame: (timestamp: number, bitmap: ImageBitmap) => {
          // Insert in sorted position (frames arrive out of order from parallel workers)
          const insertIndex = this.binarySearchInsert(timestamps, timestamp);
          timestamps.splice(insertIndex, 0, timestamp);
          frames.splice(insertIndex, 0, bitmap);

          receivedFrames++;

          // Update progress
          const progress = Math.round((receivedFrames / expectedFrames) * 100);
          onProgress?.(Math.min(progress, 99));

          // Progressive update: immediate on first frame, then every FRAMES_PER_BATCH frames
          // This gives instant visual feedback while limiting update frequency
          const shouldUpdate =
            receivedFrames === 1 || // First frame - immediate feedback
            receivedFrames - lastUpdateCount >= FRAMES_PER_BATCH;

          if (shouldUpdate) {
            lastUpdateCount = receivedFrames;

            const intermediate: CachedFilmstrip = {
              frames: [...frames],
              blobs: [], // Don't persist intermediate
              timestamps: [...timestamps],
              width: THUMBNAIL_WIDTH,
              height: THUMBNAIL_HEIGHT,
              sizeBytes: frames.length * 5000, // Estimate ~5KB per frame
              lastAccessed: Date.now(),
              isComplete: false,
            };

            // Update memory cache
            this.addToMemoryCache(mediaId, intermediate);
            // Notify subscribers
            this.notifyUpdate(mediaId, intermediate);
          }
        },

        onComplete: async () => {
          try {
            onProgress?.(95);

            // Convert ImageBitmaps to Blobs for IndexedDB persistence
            const blobs: Blob[] = [];
            let sizeBytes = 0;

            const canvas = new OffscreenCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
            const ctx = canvas.getContext('2d');

            if (ctx) {
              for (const bitmap of frames) {
                ctx.drawImage(bitmap, 0, 0);
                const blob = await canvas.convertToBlob({
                  type: 'image/jpeg',
                  quality: JPEG_QUALITY,
                });
                blobs.push(blob);
                sizeBytes += blob.size;
              }
            }

            const cached: CachedFilmstrip = {
              frames,
              blobs,
              timestamps,
              width: THUMBNAIL_WIDTH,
              height: THUMBNAIL_HEIGHT,
              sizeBytes,
              lastAccessed: Date.now(),
              isComplete: true,
            };

            // Final update to memory cache
            this.addToMemoryCache(mediaId, cached);
            this.notifyUpdate(mediaId, cached);

            // Persist to OPFS for reload persistence (faster than IndexedDB)
            try {
              const framesWithTimestamps = blobs.map((blob, i) => ({
                timestamp: timestamps[i],
                blob,
              }));
              await filmstripOPFSStorage.save(
                mediaId,
                framesWithTimestamps,
                THUMBNAIL_WIDTH,
                THUMBNAIL_HEIGHT,
                JPEG_QUALITY
              );
            } catch (err) {
              logger.warn('Failed to persist filmstrip to OPFS:', err);
            }

            onProgress?.(100);
            resolve(cached);
          } catch (err) {
            reject(err);
          }
        },

        onError: (error: Error) => {
          reject(error);
        },
      });

      // Store requestId for abort support (accessed via closure)
      (promise as any).__requestId = requestId;
    });

    // Return both promise and requestId
    return {
      promise,
      requestId: (promise as any).__requestId || '',
    };
  }

  /**
   * Load filmstrip from OPFS progressively with parallel decoding
   */
  private async loadFromOPFSProgressive(mediaId: string): Promise<CachedFilmstrip | null> {
    try {
      // Read entire file in one shot (fast I/O)
      const opfsData = await filmstripOPFSStorage.getAllFrames(mediaId);
      if (!opfsData) return null;

      const { header, frames: frameData } = opfsData;

      // Validate dimensions
      if (header.width !== THUMBNAIL_WIDTH || header.height !== THUMBNAIL_HEIGHT) {
        logger.debug(`Filmstrip cache invalidated for ${mediaId}: dimensions changed`);
        await filmstripOPFSStorage.delete(mediaId);
        return null;
      }

      const totalFrames = frameData.length;
      const imageBitmaps: ImageBitmap[] = new Array(totalFrames);
      const blobs: Blob[] = new Array(totalFrames);
      const timestamps: number[] = new Array(totalFrames);
      let sizeBytes = 0;
      let loadedCount = 0;

      // Decode in parallel batches for speed
      const DECODE_BATCH_SIZE = 20;

      for (let startIdx = 0; startIdx < totalFrames; startIdx += DECODE_BATCH_SIZE) {
        const endIdx = Math.min(startIdx + DECODE_BATCH_SIZE, totalFrames);
        const batchFrames = frameData.slice(startIdx, endIdx);

        // Parallel decode all frames in this batch
        const bitmapPromises = batchFrames.map((frame) => createImageBitmap(frame.blob));
        const decodedBitmaps = await Promise.all(bitmapPromises);

        // Store results
        for (let i = 0; i < decodedBitmaps.length; i++) {
          const idx = startIdx + i;
          const frame = batchFrames[i];
          imageBitmaps[idx] = decodedBitmaps[i];
          blobs[idx] = frame.blob;
          timestamps[idx] = frame.timestamp;
          sizeBytes += frame.blob.size;
          loadedCount++;
        }

        // Emit progressive update after each batch
        const intermediate: CachedFilmstrip = {
          frames: imageBitmaps.slice(0, loadedCount),
          blobs: blobs.slice(0, loadedCount),
          timestamps: timestamps.slice(0, loadedCount),
          width: header.width,
          height: header.height,
          sizeBytes,
          lastAccessed: Date.now(),
          isComplete: loadedCount >= totalFrames,
        };

        this.addToMemoryCache(mediaId, intermediate);
        this.notifyUpdate(mediaId, intermediate);
      }

      return {
        frames: imageBitmaps,
        blobs,
        timestamps,
        width: header.width,
        height: header.height,
        sizeBytes,
        lastAccessed: Date.now(),
        isComplete: true,
      };
    } catch (err) {
      logger.warn('Failed to load filmstrip from OPFS:', err);
      return null;
    }
  }

  /**
   * Load filmstrip from OPFS (with IndexedDB migration fallback)
   */
  private async loadFromStorage(mediaId: string): Promise<CachedFilmstrip | null> {
    // Try OPFS first with progressive loading
    const opfsResult = await this.loadFromOPFSProgressive(mediaId);
    if (opfsResult) return opfsResult;

    // Fallback: Try legacy IndexedDB and migrate
    try {
      const stored = await getFromIndexedDB(mediaId);
      if (stored && stored.frames && stored.frames.length > 0) {
        // Validate dimensions
        if (stored.width !== THUMBNAIL_WIDTH || stored.height !== THUMBNAIL_HEIGHT) {
          logger.debug(`Legacy filmstrip invalidated for ${mediaId}: dimensions changed`);
          await deleteFromIndexedDB(mediaId);
          return null;
        }

        // Convert blobs to ImageBitmaps progressively
        const imageBitmaps: ImageBitmap[] = [];
        let sizeBytes = 0;

        for (let i = 0; i < stored.frames.length; i++) {
          const blob = stored.frames[i];
          const bitmap = await createImageBitmap(blob);
          imageBitmaps.push(bitmap);
          sizeBytes += blob.size;

          // Emit progressive update every few frames
          if (i === 0 || (i + 1) % FRAMES_PER_BATCH === 0) {
            const intermediate: CachedFilmstrip = {
              frames: [...imageBitmaps],
              blobs: stored.frames.slice(0, i + 1),
              timestamps: stored.timestamps.slice(0, i + 1),
              width: stored.width,
              height: stored.height,
              sizeBytes,
              lastAccessed: Date.now(),
              isComplete: false,
            };
            this.addToMemoryCache(mediaId, intermediate);
            this.notifyUpdate(mediaId, intermediate);
          }
        }

        const cached: CachedFilmstrip = {
          frames: imageBitmaps,
          blobs: stored.frames,
          timestamps: stored.timestamps,
          width: stored.width,
          height: stored.height,
          sizeBytes,
          lastAccessed: Date.now(),
          isComplete: true,
        };

        // Final update
        this.addToMemoryCache(mediaId, cached);
        this.notifyUpdate(mediaId, cached);

        // Migrate to OPFS in background
        this.migrateToOPFS(mediaId, stored.frames, stored.timestamps).catch(() => {});

        return cached;
      }
    } catch (err) {
      logger.warn('Failed to load filmstrip from IndexedDB:', err);
    }

    return null;
  }

  /**
   * Migrate filmstrip from IndexedDB to OPFS
   */
  private async migrateToOPFS(
    mediaId: string,
    blobs: Blob[],
    timestamps: number[]
  ): Promise<void> {
    try {
      const framesWithTimestamps = blobs.map((blob, i) => ({
        timestamp: timestamps[i],
        blob,
      }));
      await filmstripOPFSStorage.save(
        mediaId,
        framesWithTimestamps,
        THUMBNAIL_WIDTH,
        THUMBNAIL_HEIGHT,
        JPEG_QUALITY
      );
      // Delete from IndexedDB after successful migration
      await deleteFromIndexedDB(mediaId);
      logger.debug(`Migrated filmstrip ${mediaId} from IndexedDB to OPFS`);
    } catch (err) {
      logger.warn(`Failed to migrate filmstrip ${mediaId}:`, err);
    }
  }

  /**
   * Get filmstrip for a media item
   * Extracts frames at fixed intervals across the full duration using 4 parallel workers
   */
  async getFilmstrip(
    mediaId: string,
    blobUrl: string,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<CachedFilmstrip> {
    // Check memory cache first
    const memoryCached = this.getFromMemoryCache(mediaId);
    if (memoryCached) {
      return memoryCached;
    }

    // Check for pending request
    const pending = this.pendingRequests.get(mediaId);
    if (pending) {
      return pending.promise;
    }

    // Check OPFS/IndexedDB for persisted filmstrip
    const stored = await this.loadFromStorage(mediaId);
    if (stored) {
      this.addToMemoryCache(mediaId, stored);
      this.notifyUpdate(mediaId, stored);
      return stored;
    }

    // Generate new filmstrip using worker pool
    const { promise, requestId } = this.generateFilmstrip(mediaId, blobUrl, duration, onProgress);

    this.pendingRequests.set(mediaId, { promise, requestId });

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingRequests.delete(mediaId);
    }
  }

  /**
   * Abort pending generation for a media item
   */
  abort(mediaId: string): void {
    const pending = this.pendingRequests.get(mediaId);
    if (pending && pending.requestId) {
      // Abort via worker pool
      filmstripWorkerPool.abort(pending.requestId);
      this.pendingRequests.delete(mediaId);
    }
  }

  /**
   * Clear filmstrips for a media item from all caches
   */
  async clearMedia(mediaId: string): Promise<void> {
    // Clear from memory cache
    const entry = this.memoryCache.get(mediaId);
    if (entry) {
      for (const bitmap of entry.frames) {
        bitmap.close();
      }
      this.currentCacheSize -= entry.sizeBytes;
      this.memoryCache.delete(mediaId);
    }

    // Clear from OPFS
    await filmstripOPFSStorage.delete(mediaId);
    // Also clear legacy IndexedDB if exists
    await deleteFromIndexedDB(mediaId).catch(() => {});
  }

  /**
   * Clear all cached filmstrips
   */
  clearAll(): void {
    // Close all ImageBitmaps
    for (const entry of this.memoryCache.values()) {
      for (const bitmap of entry.frames) {
        bitmap.close();
      }
    }

    this.memoryCache.clear();
    this.currentCacheSize = 0;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clearAll();
    // Abort all pending extractions
    for (const pending of this.pendingRequests.values()) {
      if (pending.requestId) {
        filmstripWorkerPool.abort(pending.requestId);
      }
    }
    this.pendingRequests.clear();
    this.updateCallbacks.clear();
    // Dispose worker pool
    filmstripWorkerPool.dispose();
  }
}

// Singleton instance
export const filmstripCache = new FilmstripCacheService();
// Expose cache clear for debugging
(window as any).__filmstripCache = filmstripCache;
