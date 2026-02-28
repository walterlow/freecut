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
} from '@/infrastructure/storage/indexeddb';
import { createLogger } from '@/shared/logging/logger';

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

type GifFrameUpdateCallback = (gifFrames: CachedGifFrames) => void;

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

      // Create compositing canvas (accumulates frames respecting disposal)
      const canvas = document.createElement('canvas');
      canvas.width = gif.lsd.width;
      canvas.height = gif.lsd.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get 2D context');
      }

      // Temp canvas for individual frame patches â€” drawImage composites
      // properly (respects alpha blending), unlike putImageData which
      // replaces pixels including alpha and causes flickering on
      // transparent GIFs.
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');

      if (!tempCtx) {
        throw new Error('Failed to get 2D context for temp canvas');
      }

      const imageBitmaps: ImageBitmap[] = [];
      const blobs: Blob[] = [];
      const durations: number[] = [];
      let sizeBytes = 0;
      let lastUpdateCount = 0;

      // GIF disposal state
      let previousDisposalType = 0;
      let previousDims = { left: 0, top: 0, width: 0, height: 0 };
      let savedImageData: ImageData | null = null;

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

        // === GIF disposal handling ===
        // Apply disposal from the PREVIOUS frame before drawing current.
        // Disposal types:
        //   0/1 â€” no disposal (leave previous frame in place)
        //   2   â€” restore to background (clear the previous frame's area)
        //   3   â€” restore to previous (revert canvas to saved state)
        if (i > 0) {
          if (previousDisposalType === 2) {
            ctx.clearRect(
              previousDims.left,
              previousDims.top,
              previousDims.width,
              previousDims.height,
            );
          } else if (previousDisposalType === 3 && savedImageData) {
            ctx.putImageData(savedImageData, 0, 0);
          }
        }

        // Save canvas state BEFORE drawing this frame if its disposal is
        // "restore to previous" â€” we'll need to revert to this state.
        if (frame.disposalType === 3) {
          savedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }

        // === Draw this frame's patch with proper alpha compositing ===
        // 1. Put raw pixel data on temp canvas (putImageData is fine here â€”
        //    we're just transferring raw RGBA to a blank surface).
        // 2. drawImage from temp â†’ main canvas (this composites correctly,
        //    blending transparent pixels with existing content).
        tempCanvas.width = frame.dims.width;
        tempCanvas.height = frame.dims.height;
        const imageData = new ImageData(
          new Uint8ClampedArray(frame.patch),
          frame.dims.width,
          frame.dims.height
        );
        tempCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(tempCanvas, frame.dims.left, frame.dims.top);

        // Remember disposal info for next iteration
        previousDisposalType = frame.disposalType;
        previousDims = frame.dims;

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
   * Extract animated WebP frames using the ImageDecoder API.
   * Returns null if the WebP is not animated or ImageDecoder is unavailable.
   */
  private async extractWebpFrames(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<CachedGifFrames> {
    if (typeof ImageDecoder === 'undefined') {
      throw new Error('ImageDecoder API not available');
    }

    const extractionState = { aborted: false };
    this.activeExtractions.set(mediaId, extractionState);

    const frames: ImageBitmap[] = [];
    let decoder: ImageDecoder | null = null;

    try {
      onProgress?.(5);

      const response = await fetch(blobUrl, { signal });
      if (!response.ok || !response.body) {
        throw new Error('Failed to fetch WebP');
      }

      decoder = new ImageDecoder({
        data: response.body,
        type: 'image/webp',
      });

      await decoder.completed;

      if (extractionState.aborted) {
        decoder.close();
        decoder = null;
        throw new Error('Aborted');
      }

      onProgress?.(15);

      const track = decoder.tracks.selectedTrack;
      if (!track || !track.animated || track.frameCount <= 1) {
        decoder.close();
        decoder = null;
        throw new Error('WebP is not animated');
      }

      const frameCount = track.frameCount;
      const blobs: Blob[] = [];
      const durations: number[] = [];
      let sizeBytes = 0;
      let lastUpdateCount = 0;

      for (let i = 0; i < frameCount; i++) {
        if (extractionState.aborted) {
          for (const bitmap of frames) {
            bitmap.close();
          }
          frames.length = 0;
          decoder.close();
          decoder = null;
          throw new Error('Aborted');
        }

        const result = await decoder.decode({ frameIndex: i });
        const videoFrame = result.image;

        try {
          const bitmap = await createImageBitmap(videoFrame);
          frames.push(bitmap);

          // VideoFrame.duration is in microseconds; convert to ms
          const durationMs = videoFrame.duration ? videoFrame.duration / 1000 : 100;
          durations.push(durationMs);

          sizeBytes += bitmap.width * bitmap.height * 4;
          blobs.push(new Blob()); // No IndexedDB persistence for WebP frames
        } finally {
          videoFrame.close();
        }

        const progress = 15 + Math.round((i / frameCount) * 80);
        onProgress?.(Math.min(progress, 95));

        // Progressive update
        if (frames.length - lastUpdateCount >= FRAMES_PER_BATCH) {
          lastUpdateCount = frames.length;

          const cumulativeDelays = this.computeCumulativeDelays(durations);
          const intermediate: CachedGifFrames = {
            frames: [...frames],
            blobs: [...blobs],
            durations: [...durations],
            cumulativeDelays,
            totalDuration: cumulativeDelays[cumulativeDelays.length - 1]!,
            width: frames[0]?.width ?? 0,
            height: frames[0]?.height ?? 0,
            sizeBytes,
            lastAccessed: Date.now(),
            isComplete: false,
          };

          this.addToMemoryCache(mediaId, intermediate);
          this.notifyUpdate(mediaId, intermediate);
        }
      }

      decoder.close();
      decoder = null;

      onProgress?.(95);

      const cumulativeDelays = this.computeCumulativeDelays(durations);
      const cached: CachedGifFrames = {
        frames,
        blobs,
        durations,
        cumulativeDelays,
        totalDuration: cumulativeDelays[cumulativeDelays.length - 1]!,
        width: frames[0]?.width ?? 0,
        height: frames[0]?.height ?? 0,
        sizeBytes,
        lastAccessed: Date.now(),
        isComplete: true,
      };

      this.addToMemoryCache(mediaId, cached);
      this.notifyUpdate(mediaId, cached);

      onProgress?.(100);

      return cached;
    } catch (err) {
      // Clean up any ImageBitmaps created before the error
      for (const bitmap of frames) {
        bitmap.close();
      }
      if (decoder) {
        decoder.close();
      }
      throw err;
    } finally {
      this.activeExtractions.delete(mediaId);
    }
  }

  /**
   * Get animated WebP frames for a media item.
   * Memory-only cache (no IndexedDB persistence â€” re-extracts on reload).
   */
  async getWebpFrames(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void,
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

    // Extract frames (no IndexedDB for WebP)
    const abortController = new AbortController();
    const promise = this.extractWebpFrames(mediaId, blobUrl, onProgress, abortController.signal);

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

declare global {
  interface Window {
    __gifFrameCache?: GifFrameCacheService;
    __clearAllGifCache?: () => Promise<void>;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Expose cache for debugging
  window.__gifFrameCache = gifFrameCache;

  // Debug helper: Clear all GIF frame caches (memory + IndexedDB)
  window.__clearAllGifCache = async () => {
    gifFrameCache.clearAll();
    // Clear IndexedDB gifFrames store
    const { clearAllGifFrames } = await import('@/infrastructure/storage/indexeddb');
    await clearAllGifFrames();
    logger.debug('[GifFrameCache] All caches cleared');
  };
}

