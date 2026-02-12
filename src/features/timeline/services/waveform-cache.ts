/**
 * Waveform Cache Service
 *
 * Manages waveform data caching with:
 * - In-memory LRU cache for fast access
 * - OPFS multi-resolution persistence (faster than IndexedDB)
 * - Off-main-thread waveform generation via worker
 * - Progressive streaming from OPFS on reload
 * - Auto-migration from legacy IndexedDB storage
 */

import { createLogger } from '@/lib/logger';
import {
  waveformOPFSStorage,
  WAVEFORM_LEVELS,
  chooseLevelForZoom,
  type MultiResolutionWaveform,
} from './waveform-opfs-storage';
import type { WaveformWorkerResponse } from './waveform-worker';
// Legacy IndexedDB imports for migration
import {
  getWaveform as getFromIndexedDB,
  deleteWaveform as deleteFromIndexedDB,
} from '@/lib/storage/indexeddb';

const logger = createLogger('WaveformCache');

// Memory cache configuration
const MAX_CACHE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// Samples per second for waveform generation (highest resolution)
const SAMPLES_PER_SECOND = WAVEFORM_LEVELS[0]; // 1000 samples/sec

export interface CachedWaveform {
  peaks: Float32Array;
  duration: number;
  sampleRate: number;
  channels: number;
  sizeBytes: number;
  lastAccessed: number;
  isComplete: boolean;
}

interface PendingRequest {
  promise: Promise<CachedWaveform>;
  abortController: AbortController;
}

type WaveformUpdateCallback = (waveform: CachedWaveform) => void;

class WaveformCacheService {
  private memoryCache = new Map<string, CachedWaveform>();
  private currentCacheSize = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private updateCallbacks = new Map<string, Set<WaveformUpdateCallback>>();
  private worker: Worker | null = null;
  private workerRequestId = 0;

  /**
   * Get or create the waveform worker (lazy initialization)
   */
  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./waveform-worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    return this.worker;
  }

  /**
   * Subscribe to waveform updates for progressive loading
   */
  subscribe(mediaId: string, callback: WaveformUpdateCallback): () => void {
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
   * Notify subscribers of waveform updates
   */
  private notifyUpdate(mediaId: string, waveform: CachedWaveform): void {
    const callbacks = this.updateCallbacks.get(mediaId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(waveform);
      }
    }
  }

  /**
   * Get waveform from memory cache (private)
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
   * Check if waveform exists in memory cache (synchronous)
   * Used to avoid skeleton flash when component remounts
   */
  getFromMemoryCacheSync(mediaId: string): CachedWaveform | null {
    return this.getFromMemoryCache(mediaId);
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
   * Load waveform from OPFS (with IndexedDB migration fallback)
   */
  private async loadFromStorage(mediaId: string): Promise<CachedWaveform | null> {
    // Try OPFS first
    try {
      const level = await waveformOPFSStorage.getLevel(mediaId, 0);
      if (level) {
        const cached: CachedWaveform = {
          peaks: level.peaks,
          duration: level.peaks.length / level.sampleRate,
          sampleRate: level.sampleRate,
          channels: 1,
          sizeBytes: level.peaks.byteLength,
          lastAccessed: Date.now(),
          isComplete: true,
        };

        this.addToMemoryCache(mediaId, cached);
        this.notifyUpdate(mediaId, cached);
        return cached;
      }
    } catch (err) {
      logger.warn('Failed to load waveform from OPFS, deleting corrupted data:', err);
      // Delete corrupted OPFS data so it can be regenerated
      await waveformOPFSStorage.delete(mediaId).catch(() => {});
    }

    // Fallback: Try legacy IndexedDB and migrate
    try {
      const stored = await getFromIndexedDB(mediaId);

      if (stored && stored.peaks) {
        // Convert ArrayBuffer back to Float32Array
        const peaks = new Float32Array(stored.peaks);

        const cached: CachedWaveform = {
          peaks,
          duration: stored.duration,
          sampleRate: stored.sampleRate,
          channels: stored.channels,
          sizeBytes: stored.peaks.byteLength,
          lastAccessed: Date.now(),
          isComplete: true,
        };

        // Add to memory cache
        this.addToMemoryCache(mediaId, cached);
        this.notifyUpdate(mediaId, cached);

        // Migrate to OPFS in background
        this.migrateToOPFS(mediaId, peaks, stored.duration, stored.channels).catch(() => {});

        return cached;
      }
    } catch (error) {
      logger.warn(`Failed to load waveform from IndexedDB: ${mediaId}`, error);
    }

    return null;
  }

  /**
   * Migrate waveform from IndexedDB to OPFS with multi-resolution
   */
  private async migrateToOPFS(
    mediaId: string,
    peaks: Float32Array,
    duration: number,
    channels: number
  ): Promise<void> {
    try {
      // Generate multi-resolution levels from source peaks
      const levels = waveformOPFSStorage.generateMultiResolution(
        peaks,
        100, // Legacy IndexedDB stored at 100 samples/sec
        duration
      );

      const multiRes: MultiResolutionWaveform = {
        duration,
        channels,
        levels,
      };

      await waveformOPFSStorage.save(mediaId, multiRes);

      // Delete from IndexedDB after successful migration
      await deleteFromIndexedDB(mediaId);
      logger.debug(`Migrated waveform ${mediaId} from IndexedDB to OPFS`);
    } catch (err) {
      logger.warn(`Failed to migrate waveform ${mediaId}:`, err);
    }
  }

  /**
   * Generate waveform using worker (off main thread, hardware-accelerated WebCodecs)
   */
  private async generateWaveformWithWorker(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    const worker = this.getWorker();
    const requestId = `waveform-${++this.workerRequestId}`;

    return new Promise((resolve, reject) => {
      // Add timeout - if worker doesn't respond in 30s, reject
      const timeout = setTimeout(() => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        reject(new Error('Worker timeout'));
      }, 30000);

      const handleMessage = async (event: MessageEvent<WaveformWorkerResponse>) => {
        if (event.data.requestId !== requestId) return;

        switch (event.data.type) {
          case 'progress':
            onProgress?.(event.data.progress);
            break;

          case 'complete': {
            clearTimeout(timeout);
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            const { peaks, duration, channels } = event.data;

            const cached: CachedWaveform = {
              peaks,
              duration,
              sampleRate: SAMPLES_PER_SECOND,
              channels,
              sizeBytes: peaks.byteLength,
              lastAccessed: Date.now(),
              isComplete: true,
            };

            // Add to memory cache
            this.addToMemoryCache(mediaId, cached);
            this.notifyUpdate(mediaId, cached);

            // Generate multi-resolution levels and persist to OPFS
            try {
              const levels = waveformOPFSStorage.generateMultiResolution(
                peaks,
                SAMPLES_PER_SECOND,
                duration
              );

              const multiRes: MultiResolutionWaveform = {
                duration,
                channels,
                levels,
              };

              await waveformOPFSStorage.save(mediaId, multiRes);
            } catch (saveError) {
              logger.warn('Failed to persist waveform to OPFS:', saveError);
            }

            onProgress?.(100);
            resolve(cached);
            break;
          }

          case 'error':
            clearTimeout(timeout);
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            reject(new Error(event.data.error));
            break;
        }
      };

      const handleError = (event: ErrorEvent) => {
        clearTimeout(timeout);
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        logger.error('Waveform worker error:', event.message);
        reject(new Error(event.message || 'Worker error'));
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);

      // Send request to worker
      worker.postMessage({
        type: 'generate',
        requestId,
        blobUrl,
        samplesPerSecond: SAMPLES_PER_SECOND,
      });
    });
  }

  /**
   * Fallback: Generate waveform using AudioContext on main thread
   * Used when worker fails (e.g., mediabunny not available)
   */
  private async generateWaveformFallback(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    onProgress?.(10);

    // Fetch the audio file
    const response = await fetch(blobUrl);
    const arrayBuffer = await response.arrayBuffer();
    onProgress?.(30);

    // Decode with AudioContext
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    onProgress?.(60);

    const duration = audioBuffer.duration;
    const channels = audioBuffer.numberOfChannels;

    // Mix channels to mono
    const monoSamples = new Float32Array(audioBuffer.length);
    for (let c = 0; c < channels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      for (let i = 0; i < audioBuffer.length; i++) {
        monoSamples[i]! += channelData[i]! / channels;
      }
    }
    onProgress?.(70);

    // Downsample to target samples per second
    const numOutputSamples = Math.ceil(duration * SAMPLES_PER_SECOND);
    const samplesPerOutput = Math.floor(monoSamples.length / numOutputSamples);
    const peaks = new Float32Array(numOutputSamples);

    for (let i = 0; i < numOutputSamples; i++) {
      const startIdx = i * samplesPerOutput;
      const endIdx = Math.min(startIdx + samplesPerOutput, monoSamples.length);

      let maxVal = 0;
      for (let j = startIdx; j < endIdx; j++) {
        const val = Math.abs(monoSamples[j] ?? 0);
        if (val > maxVal) maxVal = val;
      }
      peaks[i] = maxVal;
    }
    onProgress?.(85);

    // Normalize to 0-1 range
    let maxPeak = 0;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i]! > maxPeak) maxPeak = peaks[i]!;
    }
    if (maxPeak > 0) {
      for (let i = 0; i < peaks.length; i++) {
        peaks[i] = peaks[i]! / maxPeak;
      }
    }

    // Close audio context
    await audioContext.close();

    const cached: CachedWaveform = {
      peaks,
      duration,
      sampleRate: SAMPLES_PER_SECOND,
      channels,
      sizeBytes: peaks.byteLength,
      lastAccessed: Date.now(),
      isComplete: true,
    };

    // Add to memory cache
    this.addToMemoryCache(mediaId, cached);
    this.notifyUpdate(mediaId, cached);

    // Persist to OPFS
    try {
      const levels = waveformOPFSStorage.generateMultiResolution(
        peaks,
        SAMPLES_PER_SECOND,
        duration
      );

      const multiRes: MultiResolutionWaveform = {
        duration,
        channels,
        levels,
      };

      await waveformOPFSStorage.save(mediaId, multiRes);
    } catch (saveError) {
      logger.warn('Failed to persist waveform to OPFS:', saveError);
    }

    onProgress?.(100);
    return cached;
  }

  /**
   * Generate waveform with worker, falling back to AudioContext if needed
   */
  private async generateWaveform(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    try {
      return await this.generateWaveformWithWorker(mediaId, blobUrl, onProgress);
    } catch {
      // Worker may fail in some environments - fallback to AudioContext
      return await this.generateWaveformFallback(mediaId, blobUrl, onProgress);
    }
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

    // Check OPFS/IndexedDB for persisted waveform
    const storedCached = await this.loadFromStorage(mediaId);
    if (storedCached) {
      return storedCached;
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

    // Check storage asynchronously and generate if needed
    this.loadFromStorage(mediaId).then((cached) => {
      if (!cached && !this.pendingRequests.has(mediaId)) {
        // Generate in background (no progress callback)
        this.getWaveform(mediaId, blobUrl).catch((error) => {
          logger.warn('Waveform prefetch failed:', error);
        });
      }
    }).catch((error) => {
      logger.warn('Waveform storage load failed during prefetch:', error);
    });
  }

  /**
   * Abort pending generation for a media item
   */
  abort(mediaId: string): void {
    const pending = this.pendingRequests.get(mediaId);
    if (pending && this.worker) {
      // Send abort message to worker
      this.worker.postMessage({
        type: 'abort',
        requestId: `waveform-${this.workerRequestId}`,
      });
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

    // Clear from OPFS
    await waveformOPFSStorage.delete(mediaId);
    // Also clear legacy IndexedDB if exists
    await deleteFromIndexedDB(mediaId).catch(() => {});
  }

  /**
   * Clear all cached waveforms
   */
  clearAll(): void {
    this.memoryCache.clear();
    this.currentCacheSize = 0;
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.clearAll();
    this.pendingRequests.clear();
    this.updateCallbacks.clear();
    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Get waveform peaks for a specific time range at appropriate resolution
   * Used for rendering only the visible portion of long audio files
   */
  async getWaveformRange(
    mediaId: string,
    startTime: number,
    endTime: number,
    pixelsPerSecond: number
  ): Promise<{
    peaks: Float32Array;
    sampleRate: number;
    startSample: number;
  } | null> {
    const levelIndex = chooseLevelForZoom(pixelsPerSecond);
    return waveformOPFSStorage.getLevelRange(mediaId, levelIndex, startTime, endTime);
  }

  /**
   * Get waveform at a specific resolution level
   * Useful for zoom-optimized rendering
   */
  async getWaveformLevel(
    mediaId: string,
    pixelsPerSecond: number
  ): Promise<{
    peaks: Float32Array;
    sampleRate: number;
  } | null> {
    const levelIndex = chooseLevelForZoom(pixelsPerSecond);
    return waveformOPFSStorage.getLevel(mediaId, levelIndex);
  }
}

// Singleton instance
export const waveformCache = new WaveformCacheService();
