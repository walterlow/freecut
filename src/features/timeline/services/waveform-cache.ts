/**
 * Waveform Cache Service
 *
 * Manages waveform data caching with:
 * - In-memory LRU cache for fast access
 * - IndexedDB persistence across sessions
 * - Worker-based waveform generation
 */

import type { WaveformData } from '@/types/storage';
import { getWaveform, saveWaveform, deleteWaveform, reconnectDB } from '@/lib/storage/indexeddb';
import type {
  WaveformWorkerRequest,
  WaveformWorkerResponse,
} from '../workers/waveform-worker';

// Memory cache configuration
const MAX_CACHE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// Samples per second for waveform generation
const SAMPLES_PER_SECOND = 100;

export interface CachedWaveform {
  peaks: Float32Array;
  duration: number;
  sampleRate: number;
  channels: number;
  sizeBytes: number;
  lastAccessed: number;
}

interface PendingRequest {
  promise: Promise<CachedWaveform>;
  abortController: AbortController;
}

class WaveformCacheService {
  private memoryCache = new Map<string, CachedWaveform>();
  private currentCacheSize = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private worker: Worker | null = null;

  /**
   * Get waveform from memory cache
   */
  private getFromMemoryCache(mediaId: string): CachedWaveform | null {
    const cached = this.memoryCache.get(mediaId);

    if (cached) {
      // Update last accessed time
      cached.lastAccessed = Date.now();
      return cached;
    }

    return null;
  }

  /**
   * Add waveform to memory cache with LRU eviction
   */
  private addToMemoryCache(mediaId: string, data: CachedWaveform): void {
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
        this.currentCacheSize -= entry.sizeBytes;
        this.memoryCache.delete(oldestKey);
      }
    }
  }

  /**
   * Load waveform from IndexedDB and convert to memory cache format
   */
  private async loadFromIndexedDB(mediaId: string): Promise<CachedWaveform | null> {
    try {
      const stored = await getWaveform(mediaId);

      if (!stored || !stored.peaks) {
        return null;
      }

      // Convert ArrayBuffer back to Float32Array
      const peaks = new Float32Array(stored.peaks);

      const cached: CachedWaveform = {
        peaks,
        duration: stored.duration,
        sampleRate: stored.sampleRate,
        channels: stored.channels,
        sizeBytes: stored.peaks.byteLength,
        lastAccessed: Date.now(),
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
          const stored = await getWaveform(mediaId);
          if (stored && stored.peaks) {
            const peaks = new Float32Array(stored.peaks);
            const cached: CachedWaveform = {
              peaks,
              duration: stored.duration,
              sampleRate: stored.sampleRate,
              channels: stored.channels,
              sizeBytes: stored.peaks.byteLength,
              lastAccessed: Date.now(),
            };
            this.addToMemoryCache(mediaId, cached);
            return cached;
          }
        } catch (retryError) {
          console.error('Failed to load waveform after reconnection:', retryError);
        }
      } else {
        console.error(`Failed to load waveform from IndexedDB: ${mediaId}`, error);
      }
      return null;
    }
  }

  /**
   * Get or create the worker
   */
  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/waveform-worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    return this.worker;
  }

  /**
   * Generate waveform using worker
   */
  private async generateWaveform(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    const worker = this.getWorker();
    const requestId = `${mediaId}:${Date.now()}`;

    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();

      channel.port1.onmessage = async (event: MessageEvent<WaveformWorkerResponse>) => {
        const { type, payload } = event.data;

        switch (type) {
          case 'progress':
            onProgress?.(payload.progress || 0);
            break;

          case 'waveform-ready':
            try {
              const peaks = payload.peaks!;
              const duration = payload.duration!;
              const sampleRate = payload.sampleRate!;
              const channels = payload.channels!;

              // Save to IndexedDB
              const waveformData: WaveformData = {
                id: mediaId,
                mediaId,
                peaks: peaks.buffer as ArrayBuffer,
                duration,
                sampleRate,
                channels,
                createdAt: Date.now(),
              };
              await saveWaveform(waveformData);

              const cached: CachedWaveform = {
                peaks,
                duration,
                sampleRate,
                channels,
                sizeBytes: peaks.buffer.byteLength,
                lastAccessed: Date.now(),
              };

              // Add to memory cache
              this.addToMemoryCache(mediaId, cached);

              channel.port1.close();
              resolve(cached);
            } catch (error) {
              channel.port1.close();
              reject(error);
            }
            break;

          case 'error':
            channel.port1.close();
            reject(new Error(payload.error || 'Unknown error'));
            break;

          case 'aborted':
            channel.port1.close();
            reject(new Error('Aborted'));
            break;
        }
      };

      const message: WaveformWorkerRequest = {
        type: 'generate-waveform',
        payload: {
          requestId,
          mediaId,
          blobUrl,
          samplesPerSecond: SAMPLES_PER_SECOND,
        },
      };

      worker.postMessage(message, [channel.port2]);
    });
  }

  /**
   * Get waveform for a media item
   * Checks memory cache, then IndexedDB, then generates if needed
   */
  async getWaveform(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
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

    // Generate new waveform
    const abortController = new AbortController();
    const promise = this.generateWaveform(mediaId, blobUrl, onProgress);

    this.pendingRequests.set(mediaId, { promise, abortController });

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingRequests.delete(mediaId);
    }
  }

  /**
   * Prefetch waveform in background
   */
  prefetch(mediaId: string, blobUrl: string): void {
    // Skip if already cached or pending
    if (this.getFromMemoryCache(mediaId) || this.pendingRequests.has(mediaId)) {
      return;
    }

    // Check IndexedDB asynchronously and generate if needed
    this.loadFromIndexedDB(mediaId).then((cached) => {
      if (!cached && !this.pendingRequests.has(mediaId)) {
        // Generate in background (no progress callback)
        this.getWaveform(mediaId, blobUrl).catch((error) => {
          console.warn('Waveform prefetch failed:', error);
        });
      }
    });
  }

  /**
   * Abort pending generation for a media item
   */
  abort(mediaId: string): void {
    const pending = this.pendingRequests.get(mediaId);
    if (pending) {
      pending.abortController.abort();
    }
  }

  /**
   * Clear waveform for a media item from all caches
   */
  async clearMedia(mediaId: string): Promise<void> {
    // Clear from memory cache
    const entry = this.memoryCache.get(mediaId);
    if (entry) {
      this.currentCacheSize -= entry.sizeBytes;
      this.memoryCache.delete(mediaId);
    }

    // Clear from IndexedDB
    await deleteWaveform(mediaId);
  }

  /**
   * Clear all cached waveforms
   */
  clearAll(): void {
    this.memoryCache.clear();
    this.currentCacheSize = 0;
  }

  /**
   * Terminate worker
   */
  dispose(): void {
    this.clearAll();
    this.worker?.terminate();
    this.worker = null;
  }
}

// Singleton instance
export const waveformCache = new WaveformCacheService();
