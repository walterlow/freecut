/**
 * Filmstrip Cache Service
 *
 * Manages filmstrip thumbnail caching with:
 * - In-memory LRU cache for fast access
 * - IndexedDB persistence across sessions
 * - Hardware-accelerated frame extraction via mediabunny (WebCodecs)
 * - Calculates exact frame count based on visible thumbnail slots
 */

import type { FilmstripData } from '@/types/storage';
import {
  getFilmstripByMediaId,
  saveFilmstrip,
  deleteFilmstripsByMediaId,
  reconnectDB,
} from '@/lib/storage/indexeddb';

// Dynamically import mediabunny (heavy library)
const mediabunnyModule = () => import('mediabunny');

// Thumbnail dimensions
const THUMBNAIL_WIDTH = 71;
const THUMBNAIL_HEIGHT = 40;
const JPEG_QUALITY = 0.7;

// Performance guards
const MIN_FRAME_INTERVAL = 0.05; // Don't extract more than 20 frames per second
const MAX_FRAMES = 500; // Cap total frames for very long videos

// Memory cache configuration
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

// Progressive loading: frames per update batch
const FRAMES_PER_BATCH = 5;

export interface CachedFilmstrip {
  frames: ImageBitmap[];
  timestamps: number[];
  width: number;
  height: number;
  sizeBytes: number;
  lastAccessed: number;
  isComplete: boolean;
}

interface PendingRequest {
  promise: Promise<CachedFilmstrip>;
  abortController: AbortController;
}

export type FilmstripUpdateCallback = (filmstrip: CachedFilmstrip) => void;

class FilmstripCacheService {
  private memoryCache = new Map<string, CachedFilmstrip>();
  private currentCacheSize = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private activeExtractions = new Map<string, { aborted: boolean }>();
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
   * Calculate the number of frames needed for a given clip width and duration
   * One frame per thumbnail slot (71px)
   */
  calculateFrameCount(clipWidth: number, duration: number): number {
    // Number of thumbnail slots that fit in the clip
    const slotCount = Math.ceil(clipWidth / THUMBNAIL_WIDTH);

    // Calculate interval between frames
    const interval = duration / slotCount;

    // If interval is too small, limit frames for performance
    if (interval < MIN_FRAME_INTERVAL) {
      return Math.min(Math.ceil(duration / MIN_FRAME_INTERVAL), MAX_FRAMES);
    }

    return Math.min(slotCount, MAX_FRAMES);
  }

  /**
   * Get filmstrip from memory cache
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
   * Load filmstrip from IndexedDB and convert to memory cache format
   */
  private async loadFromIndexedDB(mediaId: string): Promise<CachedFilmstrip | null> {
    try {
      const stored = await getFilmstripByMediaId(mediaId);

      if (!stored || stored.frames.length === 0) {
        return null;
      }

      // Convert Blobs to ImageBitmaps
      const frames: ImageBitmap[] = [];
      let sizeBytes = 0;

      for (const blob of stored.frames) {
        const bitmap = await createImageBitmap(blob);
        frames.push(bitmap);
        sizeBytes += blob.size;
      }

      const cached: CachedFilmstrip = {
        frames,
        timestamps: stored.timestamps,
        width: stored.width,
        height: stored.height,
        sizeBytes,
        lastAccessed: Date.now(),
        isComplete: true,
      };

      // Add to memory cache
      this.addToMemoryCache(mediaId, cached);

      return cached;
    } catch (error) {
      // Check if this is a missing object store error (database needs upgrade)
      if (error instanceof Error && error.message.includes('object store')) {
        console.warn('IndexedDB schema outdated, attempting reconnection...');
        try {
          await reconnectDB();
          // Retry once after reconnection
          const stored = await getFilmstripByMediaId(mediaId);
          if (stored && stored.frames.length > 0) {
            const frames: ImageBitmap[] = [];
            let sizeBytes = 0;
            for (const blob of stored.frames) {
              const bitmap = await createImageBitmap(blob);
              frames.push(bitmap);
              sizeBytes += blob.size;
            }
            const cached: CachedFilmstrip = {
              frames,
              timestamps: stored.timestamps,
              width: stored.width,
              height: stored.height,
              sizeBytes,
              lastAccessed: Date.now(),
              isComplete: true,
            };
            this.addToMemoryCache(mediaId, cached);
            return cached;
          }
        } catch (retryError) {
          console.error('Failed to load filmstrip after reconnection:', retryError);
        }
      } else {
        console.error(`Failed to load filmstrip from IndexedDB: ${mediaId}`, error);
      }
      return null;
    }
  }

  /**
   * Calculate frame timestamps evenly distributed across the duration
   */
  private calculateTimestamps(duration: number, frameCount: number): number[] {
    const timestamps: number[] = [];

    if (frameCount <= 0) return timestamps;

    // For single frame, use middle of video
    if (frameCount === 1) {
      timestamps.push(Math.min(0.1, duration / 2));
      return timestamps;
    }

    // Distribute frames evenly, with slight offset from start to avoid black frames
    const interval = duration / frameCount;
    for (let i = 0; i < frameCount; i++) {
      // Start at half-interval offset to center frames in their slots
      const time = (i + 0.5) * interval;
      // Clamp to valid range with small offset from edges
      timestamps.push(Math.max(0.05, Math.min(time, duration - 0.05)));
    }

    return timestamps;
  }

  /**
   * Generate filmstrip using mediabunny (hardware-accelerated WebCodecs)
   */
  private async generateFilmstrip(
    mediaId: string,
    blobUrl: string,
    duration: number,
    frameCount: number,
    onProgress?: (progress: number) => void
  ): Promise<CachedFilmstrip> {
    const extractionState = { aborted: false };
    this.activeExtractions.set(mediaId, extractionState);

    // Load mediabunny
    const mediabunny = await mediabunnyModule();
    const { Input, UrlSource, VideoSampleSink, MP4, WEBM, MATROSKA } = mediabunny;

    let input: InstanceType<typeof Input> | null = null;

    try {
      // Calculate timestamps
      const timestamps = this.calculateTimestamps(duration, frameCount);
      const frames: Blob[] = [];

      onProgress?.(5);

      // Create input from blob URL with common video formats
      input = new Input({
        source: new UrlSource(blobUrl),
        formats: [MP4, WEBM, MATROSKA],
      });

      // Get primary video track
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error('No video track found');
      }

      onProgress?.(10);

      // Create video sample sink for frame extraction
      const sink = new VideoSampleSink(videoTrack);

      // Create canvas for rendering frames
      const canvas = document.createElement('canvas');
      canvas.width = THUMBNAIL_WIDTH;
      canvas.height = THUMBNAIL_HEIGHT;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get 2D context');
      }

      // Extract frames at timestamps with progressive updates
      let frameIndex = 0;
      let lastUpdateCount = 0;
      const imageBitmaps: ImageBitmap[] = [];
      let sizeBytes = 0;

      for await (const sample of sink.samplesAtTimestamps(timestamps)) {
        // Check for abort
        if (extractionState.aborted) {
          sample?.close();
          throw new Error('Aborted');
        }

        if (sample) {
          // Draw sample to canvas with fit behavior
          sample.drawWithFit(ctx, { fit: 'cover' });
          sample.close(); // Release VideoFrame resources

          // Convert to JPEG blob
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => {
                if (b) resolve(b);
                else reject(new Error('Failed to create blob'));
              },
              'image/jpeg',
              JPEG_QUALITY
            );
          });

          frames.push(blob);

          // Create ImageBitmap immediately for progressive display
          const bitmap = await createImageBitmap(blob);
          imageBitmaps.push(bitmap);
          sizeBytes += blob.size;
        }

        frameIndex++;
        const progress = 10 + Math.round((frameIndex / timestamps.length) * 80);
        onProgress?.(progress);

        // Progressive update: notify subscribers every FRAMES_PER_BATCH frames
        if (frameIndex - lastUpdateCount >= FRAMES_PER_BATCH || frameIndex === timestamps.length) {
          lastUpdateCount = frameIndex;

          const intermediate: CachedFilmstrip = {
            frames: [...imageBitmaps],
            timestamps: timestamps.slice(0, imageBitmaps.length),
            width: THUMBNAIL_WIDTH,
            height: THUMBNAIL_HEIGHT,
            sizeBytes,
            lastAccessed: Date.now(),
            isComplete: frameIndex === timestamps.length,
          };

          // Update memory cache
          this.addToMemoryCache(mediaId, intermediate);
          // Notify subscribers
          this.notifyUpdate(mediaId, intermediate);
        }
      }

      onProgress?.(95);

      // Save to IndexedDB
      const filmstripData: FilmstripData = {
        id: mediaId,
        mediaId,
        density: 'high', // Legacy field, keeping for compatibility
        frames,
        timestamps: timestamps.slice(0, frames.length),
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        createdAt: Date.now(),
      };
      await saveFilmstrip(filmstripData);

      const cached: CachedFilmstrip = {
        frames: imageBitmaps,
        timestamps: timestamps.slice(0, frames.length),
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        sizeBytes,
        lastAccessed: Date.now(),
        isComplete: true,
      };

      // Final update to memory cache
      this.addToMemoryCache(mediaId, cached);
      this.notifyUpdate(mediaId, cached);

      onProgress?.(100);

      return cached;
    } finally {
      // Clean up mediabunny input
      input?.dispose();
      this.activeExtractions.delete(mediaId);
    }
  }

  /**
   * Get filmstrip for a media item
   * Checks memory cache, then IndexedDB, then generates if needed
   */
  async getFilmstrip(
    mediaId: string,
    blobUrl: string,
    duration: number,
    clipWidth: number,
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

    // Check IndexedDB
    const dbCached = await this.loadFromIndexedDB(mediaId);
    if (dbCached) {
      return dbCached;
    }

    // Calculate frame count based on clip width
    const frameCount = this.calculateFrameCount(clipWidth, duration);

    // Generate new filmstrip
    const abortController = new AbortController();
    const promise = this.generateFilmstrip(mediaId, blobUrl, duration, frameCount, onProgress);

    this.pendingRequests.set(mediaId, { promise, abortController });

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

    // Clear from IndexedDB
    await deleteFilmstripsByMediaId(mediaId);
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
    // Abort all active extractions
    for (const state of this.activeExtractions.values()) {
      state.aborted = true;
    }
    this.activeExtractions.clear();
    this.updateCallbacks.clear();
  }
}

// Singleton instance
export const filmstripCache = new FilmstripCacheService();
// Expose cache clear for debugging
(window as any).__filmstripCache = filmstripCache;
