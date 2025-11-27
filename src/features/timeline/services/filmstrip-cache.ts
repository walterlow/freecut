/**
 * Filmstrip Cache Service
 *
 * Manages filmstrip thumbnail caching with:
 * - In-memory LRU cache for fast access
 * - Hardware-accelerated frame extraction via mediabunny (WebCodecs)
 * - Fixed frame density for consistent quality
 * - Rendering matches frames to display slots by timestamp
 */

import {
  deleteFilmstripsByMediaId,
  getFilmstripByMediaId,
  saveFilmstrip,
} from '@/lib/storage/indexeddb';
import type { FilmstripData } from '@/types/storage';
import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from '@/constants/timeline';

// Dynamically import mediabunny (heavy library)
const mediabunnyModule = () => import('mediabunny');

// Re-export for consumers that import from this file
export { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT };
const JPEG_QUALITY = 0.7;

// Target frame interval for filmstrip (pick one frame per this many seconds)
// ~0.042s = keep ~24 frames per second for frame-accurate scrubbing
const TARGET_FRAME_INTERVAL = 1 / 24;

// Memory cache configuration
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

// Progressive loading: frames per update batch
const FRAMES_PER_BATCH = 10;

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
   * Generate filmstrip using mediabunny (hardware-accelerated WebCodecs)
   * Uses samples() to iterate through actual video frames for proper distribution
   */
  private async generateFilmstrip(
    mediaId: string,
    blobUrl: string,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<CachedFilmstrip> {
    const extractionState = { aborted: false };
    this.activeExtractions.set(mediaId, extractionState);

    // Load mediabunny
    const mediabunny = await mediabunnyModule();
    const { Input, UrlSource, VideoSampleSink, MP4, WEBM, MATROSKA } = mediabunny;

    let input: InstanceType<typeof Input> | null = null;

    try {
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

      // Sample frames at regular intervals from actual video frames
      const imageBitmaps: ImageBitmap[] = [];
      const blobs: Blob[] = [];
      const timestamps: number[] = [];
      let sizeBytes = 0;
      let lastUpdateCount = 0;
      let nextTargetTime = 0; // Next time we want to capture a frame
      let framesSampled = 0;

      // Iterate through ALL actual video frames and pick at intervals
      try {
        for await (const sample of sink.samples()) {
          // Check for abort
          if (extractionState.aborted) {
            sample.close();
            throw new Error('Aborted');
          }

          // Get the actual timestamp of this frame (already in seconds)
          const frameTime = sample.timestamp;

          // Check if this frame is at or past our target time
          if (frameTime >= nextTargetTime) {
            // Capture this frame
            sample.drawWithFit(ctx, { fit: 'cover' });

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

            // Create ImageBitmap for display
            const bitmap = await createImageBitmap(blob);
            imageBitmaps.push(bitmap);
            blobs.push(blob); // Keep for IndexedDB persistence
            timestamps.push(frameTime);
            sizeBytes += blob.size;
            framesSampled++;

            // Set next target time
            nextTargetTime = frameTime + TARGET_FRAME_INTERVAL;

            // Update progress based on time through video
            const progress = 10 + Math.round((frameTime / duration) * 80);
            onProgress?.(Math.min(progress, 90));

            // Progressive update: notify subscribers every FRAMES_PER_BATCH frames
            if (framesSampled - lastUpdateCount >= FRAMES_PER_BATCH) {
              lastUpdateCount = framesSampled;

              const intermediate: CachedFilmstrip = {
                frames: [...imageBitmaps],
                blobs: [...blobs],
                timestamps: [...timestamps],
                width: THUMBNAIL_WIDTH,
                height: THUMBNAIL_HEIGHT,
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

          // Release VideoFrame resources
          sample.close();
        }
      } catch (loopError) {
        // Re-throw errors (aborts are handled by caller)
        throw loopError;
      }

      onProgress?.(95);

      const cached: CachedFilmstrip = {
        frames: imageBitmaps,
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

      // Persist to IndexedDB for reload persistence
      try {
        const filmstripData: FilmstripData = {
          id: `${mediaId}:high`,
          mediaId,
          density: 'high',
          frames: blobs,
          timestamps,
          width: THUMBNAIL_WIDTH,
          height: THUMBNAIL_HEIGHT,
          createdAt: Date.now(),
        };
        await saveFilmstrip(filmstripData);
      } catch (err) {
        console.warn('Failed to persist filmstrip to IndexedDB:', err);
      }

      onProgress?.(100);

      return cached;
    } finally {
      // Clean up mediabunny input
      input?.dispose();
      this.activeExtractions.delete(mediaId);
    }
  }

  /**
   * Load filmstrip from IndexedDB and convert blobs to ImageBitmaps
   */
  private async loadFromIndexedDB(mediaId: string): Promise<CachedFilmstrip | null> {
    try {
      const stored = await getFilmstripByMediaId(mediaId);
      if (!stored || !stored.frames || stored.frames.length === 0) {
        return null;
      }

      // Validate dimensions match current constants (invalidate if size changed)
      if (stored.width !== THUMBNAIL_WIDTH || stored.height !== THUMBNAIL_HEIGHT) {
        console.log(`Filmstrip cache invalidated for ${mediaId}: dimensions changed from ${stored.width}x${stored.height} to ${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}`);
        await deleteFilmstripsByMediaId(mediaId);
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

      return cached;
    } catch (err) {
      console.warn('Failed to load filmstrip from IndexedDB:', err);
      return null;
    }
  }

  /**
   * Get filmstrip for a media item
   * Extracts frames at fixed intervals across the full duration
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

    // Check IndexedDB for persisted filmstrip
    const stored = await this.loadFromIndexedDB(mediaId);
    if (stored) {
      this.addToMemoryCache(mediaId, stored);
      this.notifyUpdate(mediaId, stored);
      return stored;
    }

    // Generate new filmstrip
    const abortController = new AbortController();
    const promise = this.generateFilmstrip(mediaId, blobUrl, duration, onProgress);

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
