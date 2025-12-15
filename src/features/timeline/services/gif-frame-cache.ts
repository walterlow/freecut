/**
 * GIF Frame Cache Service
 *
 * Manages GIF frame caching with:
 * - In-memory LRU cache for fast access
 * - Pre-extraction of all frames using gifuct-js
 * - O(1) frame lookup via binary search on cumulative delays
 * - IndexedDB persistence for reload
 */

import {
  deleteGifFrames,
  getGifFrames as getGifFramesFromDB,
  saveGifFrames,
} from '../../../lib/storage/indexeddb';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GifFrameCache');
import type { GifFrameData } from '../../../types/storage';
import { parseGIF, decompressFrames } from 'gifuct-js';

// Memory cache configuration
const MAX_CACHE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB

// Progressive loading: frames per update batch
const FRAMES_PER_BATCH = 20;

export interface CachedGifFrames {
  frames: ImageBitmap[];
  blobs: Blob[]; // Keep blobs for IndexedDB persistence
  durations: number[]; // Per-frame delay in milliseconds
  cumulativeDelays: number[]; // Precomputed: [0, d1, d1+d2, ...] for O(1) lookup
  totalDuration: number;
  width: number;
  height: number;
  sizeBytes: number;
  lastAccessed: number;
  isComplete: boolean;
}

interface PendingRequest {
  promise: Promise<CachedGifFrames>;
  abortController: AbortController;
}

export type GifFrameUpdateCallback = (gifFrames: CachedGifFrames) => void;

class GifFrameCacheService {
  private memoryCache = new Map<string, CachedGifFrames>();
  private currentCacheSize = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private activeExtractions = new Map<string, { aborted: boolean }>();
  private updateCallbacks = new Map<string, Set<GifFrameUpdateCallback>>();

  /**
   * Subscribe to GIF frame updates for progressive loading
   */
  subscribe(mediaId: string, callback: GifFrameUpdateCallback): () => void {
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
   * Notify subscribers of GIF frame updates
   */
  private notifyUpdate(mediaId: string, gifFrames: CachedGifFrames): void {
    const callbacks = this.updateCallbacks.get(mediaId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(gifFrames);
      }
    }
  }

  /**
   * Get GIF frames from memory cache
   */
  private getFromMemoryCache(mediaId: string): CachedGifFrames | null {
    const cached = this.memoryCache.get(mediaId);

    if (cached) {
      // Update last accessed time
      cached.lastAccessed = Date.now();
      return cached;
    }

    return null;
  }

  /**
   * Add GIF frames to memory cache with LRU eviction
   */
  private addToMemoryCache(mediaId: string, data: CachedGifFrames): void {
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
   * Compute cumulative delays array for O(1) frame lookup
   * e.g., durations [100, 50, 100] -> cumulative [0, 100, 150, 250]
   */
  private computeCumulativeDelays(durations: number[]): number[] {
    const cumulative = [0];
    let sum = 0;
    for (const d of durations) {
      sum += d;
      cumulative.push(sum);
    }
    return cumulative;
  }

  /**
   * Get frame at specific time using binary search
   * O(log n) - effectively O(1) for typical GIFs
   */
  getFrameAtTime(cached: CachedGifFrames, timeMs: number): { frame: ImageBitmap; index: number } {
    const { cumulativeDelays, frames, totalDuration } = cached;

    if (frames.length === 0) {
      throw new Error('No frames available');
    }

    // Handle looping - normalize time to [0, totalDuration)
    const normalizedTime = totalDuration > 0
      ? ((timeMs % totalDuration) + totalDuration) % totalDuration
      : 0;

    // Binary search on cumulativeDelays
    let left = 0;
    let right = cumulativeDelays.length - 2; // Last valid frame index

    while (left < right) {
      const mid = Math.floor((left + right + 1) / 2);
      if (cumulativeDelays[mid]! <= normalizedTime) {
        left = mid;
      } else {
        right = mid - 1;
      }
    }

    return { frame: frames[left]!, index: left };
  }

  /**
   * Extract GIF frames using gifuct-js
   */
  private async extractGifFrames(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedGifFrames> {
    const extractionState = { aborted: false };
    this.activeExtractions.set(mediaId, extractionState);

    try {
      onProgress?.(5);

      // Fetch GIF as ArrayBuffer
      const response = await fetch(blobUrl);
      const arrayBuffer = await response.arrayBuffer();

      if (extractionState.aborted) {
        throw new Error('Aborted');
      }

      onProgress?.(15);

      // Parse GIF structure
      const gif = parseGIF(arrayBuffer);
      const rawFrames = decompressFrames(gif, true); // true = build patch (compositing)

      if (extractionState.aborted) {
        throw new Error('Aborted');
      }

      onProgress?.(25);

      // Create canvas for rendering
      const canvas = document.createElement('canvas');
      canvas.width = gif.lsd.width;
      canvas.height = gif.lsd.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get 2D context');
      }

      const imageBitmaps: ImageBitmap[] = [];
      const blobs: Blob[] = [];
      const durations: number[] = [];
      let sizeBytes = 0;
      let lastUpdateCount = 0;

      // Process each frame
      for (let i = 0; i < rawFrames.length; i++) {
        if (extractionState.aborted) {
          // Clean up already created bitmaps
          for (const bitmap of imageBitmaps) {
            bitmap.close();
          }
          throw new Error('Aborted');
        }

        const frame = rawFrames[i]!

        // Apply frame patch to canvas
        // The patch already contains composited pixel data from gifuct-js
        const imageData = new ImageData(
          new Uint8ClampedArray(frame.patch),
          frame.dims.width,
          frame.dims.height
        );
        ctx.putImageData(imageData, frame.dims.left, frame.dims.top);

        // Convert to PNG blob (preserve transparency)
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error('Failed to create blob'));
            },
            'image/png'
          );
        });

        // Create ImageBitmap for display
        const bitmap = await createImageBitmap(blob);
        imageBitmaps.push(bitmap);
        blobs.push(blob);
        // gifuct-js returns delay in milliseconds (not centiseconds as per GIF spec)
        // Use default of 100ms if delay is 0 or missing
        const delay = frame.delay > 0 ? frame.delay : 100;
        durations.push(delay);
        sizeBytes += blob.size;

        // Update progress
        const progress = 25 + Math.round((i / rawFrames.length) * 65);
        onProgress?.(Math.min(progress, 90));

        // Progressive update: notify subscribers every FRAMES_PER_BATCH frames
        if (imageBitmaps.length - lastUpdateCount >= FRAMES_PER_BATCH) {
          lastUpdateCount = imageBitmaps.length;

          const cumulativeDelays = this.computeCumulativeDelays(durations);
          const intermediate: CachedGifFrames = {
            frames: [...imageBitmaps],
            blobs: [...blobs],
            durations: [...durations],
            cumulativeDelays,
            totalDuration: cumulativeDelays[cumulativeDelays.length - 1]!,
            width: gif.lsd.width,
            height: gif.lsd.height,
            sizeBytes,
            lastAccessed: Date.now(),
            isComplete: false,
          };

          // Update memory cache
          this.addToMemoryCache(mediaId, intermediate);
          // Notify subscribers
          this.notifyUpdate(mediaId, intermediate);
        }
      }

      onProgress?.(95);

      const cumulativeDelays = this.computeCumulativeDelays(durations);
      const cached: CachedGifFrames = {
        frames: imageBitmaps,
        blobs,
        durations,
        cumulativeDelays,
        totalDuration: cumulativeDelays[cumulativeDelays.length - 1]!,
        width: gif.lsd.width,
        height: gif.lsd.height,
        sizeBytes,
        lastAccessed: Date.now(),
        isComplete: true,
      };

      // Final update to memory cache
      this.addToMemoryCache(mediaId, cached);
      this.notifyUpdate(mediaId, cached);

      // Persist to IndexedDB for reload persistence
      try {
        const gifFrameData: GifFrameData = {
          id: mediaId,
          mediaId,
          frames: blobs,
          durations,
          totalDuration: cached.totalDuration,
          width: gif.lsd.width,
          height: gif.lsd.height,
          frameCount: blobs.length,
          createdAt: Date.now(),
        };
        await saveGifFrames(gifFrameData);
      } catch (err) {
        logger.warn('Failed to persist GIF frames to IndexedDB:', err);
      }

      onProgress?.(100);

      return cached;
    } finally {
      this.activeExtractions.delete(mediaId);
    }
  }

  /**
   * Load GIF frames from IndexedDB and convert blobs to ImageBitmaps
   */
  private async loadFromIndexedDB(mediaId: string): Promise<CachedGifFrames | null> {
    try {
      const stored = await getGifFramesFromDB(mediaId);
      if (!stored || !stored.frames || stored.frames.length === 0) {
        return null;
      }

      // Convert blobs to ImageBitmaps
      const imageBitmaps: ImageBitmap[] = [];
      let sizeBytes = 0;

      for (const blob of stored.frames) {
        const bitmap = await createImageBitmap(blob);
        imageBitmaps.push(bitmap);
        sizeBytes += blob.size;
      }

      const cumulativeDelays = this.computeCumulativeDelays(stored.durations);
      const cached: CachedGifFrames = {
        frames: imageBitmaps,
        blobs: stored.frames,
        durations: stored.durations,
        cumulativeDelays,
        totalDuration: stored.totalDuration,
        width: stored.width,
        height: stored.height,
        sizeBytes,
        lastAccessed: Date.now(),
        isComplete: true,
      };

      return cached;
    } catch (err) {
      logger.warn('Failed to load GIF frames from IndexedDB:', err);
      return null;
    }
  }

  /**
   * Get GIF frames for a media item
   * Checks memory -> IndexedDB -> extracts new
   */
  async getGifFrames(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedGifFrames> {
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

    // Check IndexedDB for persisted frames
    const stored = await this.loadFromIndexedDB(mediaId);
    if (stored) {
      this.addToMemoryCache(mediaId, stored);
      this.notifyUpdate(mediaId, stored);
      return stored;
    }

    // Extract new frames
    const abortController = new AbortController();
    const promise = this.extractGifFrames(mediaId, blobUrl, onProgress);

    this.pendingRequests.set(mediaId, { promise, abortController });

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingRequests.delete(mediaId);
    }
  }

  /**
   * Abort pending extraction for a media item
   */
  abort(mediaId: string): void {
    // Abort pending requests
    const pending = this.pendingRequests.get(mediaId);
    if (pending) {
      pending.abortController.abort();
    }
    // Abort active extractions
    const state = this.activeExtractions.get(mediaId);
    if (state) {
      state.aborted = true;
    }
  }

  /**
   * Clear GIF frames for a media item from all caches
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

    // Clear from IndexedDB
    await deleteGifFrames(mediaId);
  }

  /**
   * Clear all cached GIF frames
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
    // Abort all active extractions
    for (const state of this.activeExtractions.values()) {
      state.aborted = true;
    }
    this.activeExtractions.clear();
    this.updateCallbacks.clear();
  }
}

// Singleton instance
export const gifFrameCache = new GifFrameCacheService();
// Expose cache for debugging
(window as any).__gifFrameCache = gifFrameCache;

// Debug helper: Clear all GIF frame caches (memory + IndexedDB)
(window as any).__clearAllGifCache = async () => {
  gifFrameCache.clearAll();
  // Clear IndexedDB gifFrames store
  const { clearAllGifFrames } = await import('../../../lib/storage/indexeddb');
  await clearAllGifFrames();
  logger.debug('[GifFrameCache] All caches cleared');
};
