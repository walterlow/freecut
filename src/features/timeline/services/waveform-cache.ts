/**
 * Waveform Cache Service
 *
 * Manages waveform data caching with:
 * - In-memory LRU cache for fast access
 * - IndexedDB binned persistence for progressive decode durability
 * - OPFS multi-resolution persistence for zoom/range reads
 * - Off-main-thread waveform generation via worker
 * - Progressive streaming updates while decoding
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
import type { WaveformBin } from '@/types/storage';
import {
  getWaveform as getLegacyWaveformFromIndexedDB,
  getWaveformRecord as getWaveformRecordFromIndexedDB,
  getWaveformMeta as getWaveformMetaFromIndexedDB,
  getWaveformBins as getWaveformBinsFromIndexedDB,
  saveWaveformBin as saveWaveformBinToIndexedDB,
  saveWaveformMeta as saveWaveformMetaToIndexedDB,
  deleteWaveform as deleteWaveformFromIndexedDB,
} from '@/lib/storage/indexeddb';

const logger = createLogger('WaveformCache');

// Memory cache configuration
const MAX_CACHE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_CONCURRENT_WAVEFORM_GENERATIONS = 1;

// Samples per second for waveform generation (highest resolution)
const SAMPLES_PER_SECOND = WAVEFORM_LEVELS[0]; // 1000 samples/sec
const WAVEFORM_BIN_DURATION_SEC = 5;
const WAVEFORM_BIN_SAMPLES = SAMPLES_PER_SECOND * WAVEFORM_BIN_DURATION_SEC;

export interface CachedWaveform {
  peaks: Float32Array;
  duration: number;
  sampleRate: number;
  channels: number;
  sizeBytes: number;
  lastAccessed: number;
  isComplete: boolean;
}

export class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

interface PendingRequest {
  promise: Promise<CachedWaveform>;
  requestId: string;
  status: 'queued' | 'running';
  reject: (error: Error) => void;
}

interface QueuedGeneration {
  mediaId: string;
  blobUrl: string;
  requestId: string;
  onProgress?: (progress: number) => void;
  resolve: (waveform: CachedWaveform) => void;
  reject: (error: Error) => void;
}

type WaveformUpdateCallback = (waveform: CachedWaveform) => void;

class WaveformCacheService {
  private memoryCache = new Map<string, CachedWaveform>();
  private currentCacheSize = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private updateCallbacks = new Map<string, Set<WaveformUpdateCallback>>();
  private worker: Worker | null = null;
  private workerRequestId = 0;
  private generationQueue: QueuedGeneration[] = [];
  private activeGenerations = new Set<string>();
  private workerRejectors = new Map<string, (error: Error) => void>();
  private fallbackAbortControllers = new Map<string, AbortController>();

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

  private enqueueGeneration(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    const requestId = `waveform-${++this.workerRequestId}`;

    let resolvePromise!: (waveform: CachedWaveform) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<CachedWaveform>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this.pendingRequests.set(mediaId, {
      promise,
      requestId,
      status: 'queued',
      reject: rejectPromise,
    });

    this.generationQueue.push({
      mediaId,
      blobUrl,
      requestId,
      onProgress,
      resolve: resolvePromise,
      reject: rejectPromise,
    });

    this.processGenerationQueue();
    return promise;
  }

  private processGenerationQueue(): void {
    while (
      this.activeGenerations.size < MAX_CONCURRENT_WAVEFORM_GENERATIONS &&
      this.generationQueue.length > 0
    ) {
      const queued = this.generationQueue.shift();
      if (!queued) return;

      const pending = this.pendingRequests.get(queued.mediaId);
      if (!pending || pending.requestId !== queued.requestId) {
        queued.reject(new Error('Superseded'));
        continue;
      }

      pending.status = 'running';
      this.activeGenerations.add(queued.mediaId);
      void this.startQueuedGeneration(queued);
    }
  }

  private async startQueuedGeneration(queued: QueuedGeneration): Promise<void> {
    try {
      const waveform = await this.generateWaveform(
        queued.mediaId,
        queued.blobUrl,
        queued.requestId,
        queued.onProgress
      );
      queued.resolve(waveform);
    } catch (error) {
      queued.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeGenerations.delete(queued.mediaId);
      const pending = this.pendingRequests.get(queued.mediaId);
      if (pending && pending.requestId === queued.requestId) {
        this.pendingRequests.delete(queued.mediaId);
      }
      this.processGenerationQueue();
    }
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
    const existing = this.memoryCache.get(mediaId);
    if (existing) {
      this.currentCacheSize -= existing.sizeBytes;
      this.memoryCache.delete(mediaId);
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
        this.currentCacheSize -= entry.sizeBytes;
        this.memoryCache.delete(oldestKey);
      }
    }
  }

  private makeCachedWaveform(
    peaks: Float32Array,
    duration: number,
    channels: number,
    isComplete: boolean
  ): CachedWaveform {
    return {
      peaks,
      duration,
      sampleRate: SAMPLES_PER_SECOND,
      channels,
      sizeBytes: peaks.byteLength,
      lastAccessed: Date.now(),
      isComplete,
    };
  }

  private async persistToOPFS(
    mediaId: string,
    peaks: Float32Array,
    duration: number,
    channels: number
  ): Promise<void> {
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
  }

  private async persistBinnedWaveform(
    mediaId: string,
    peaks: Float32Array,
    duration: number,
    channels: number
  ): Promise<void> {
    await deleteWaveformFromIndexedDB(mediaId).catch(() => {});

    const binCount = Math.ceil(peaks.length / WAVEFORM_BIN_SAMPLES);
    const now = Date.now();
    for (let binIndex = 0; binIndex < binCount; binIndex++) {
      const start = binIndex * WAVEFORM_BIN_SAMPLES;
      const end = Math.min(start + WAVEFORM_BIN_SAMPLES, peaks.length);
      const chunk = peaks.slice(start, end);
      const bin: WaveformBin = {
        id: `${mediaId}:bin:${binIndex}`,
        mediaId,
        kind: 'bin',
        binIndex,
        peaks: chunk.buffer,
        samples: chunk.length,
        createdAt: now,
      };
      await saveWaveformBinToIndexedDB(bin);
    }

    await saveWaveformMetaToIndexedDB({
      id: mediaId,
      mediaId,
      kind: 'meta',
      sampleRate: SAMPLES_PER_SECOND,
      totalSamples: peaks.length,
      binCount,
      binDurationSec: WAVEFORM_BIN_DURATION_SEC,
      duration,
      channels,
      createdAt: now,
    });
  }

  /**
   * Load waveform from storage:
   * 1) IndexedDB streamed bins (meta + bins)
   * 2) OPFS multi-resolution cache
   * 3) Legacy IndexedDB single-record waveform
   */
  private async loadFromStorage(mediaId: string): Promise<CachedWaveform | null> {
    // Try binned IndexedDB first (new progressive format).
    try {
      const meta = await getWaveformMetaFromIndexedDB(mediaId);
      if (meta) {
        const bins = await getWaveformBinsFromIndexedDB(mediaId, meta.binCount);
        if (bins.length === meta.binCount) {
          const peaks = new Float32Array(meta.totalSamples);
          let writeOffset = 0;
          let valid = true;

          for (let i = 0; i < bins.length; i++) {
            const bin = bins[i];
            if (!bin || bin.binIndex !== i || !bin.peaks) {
              valid = false;
              break;
            }

            const binPeaks = new Float32Array(bin.peaks);
            const expectedSamples = Math.max(0, bin.samples ?? binPeaks.length);
            const available = Math.min(expectedSamples, binPeaks.length, peaks.length - writeOffset);
            if (available <= 0) {
              valid = false;
              break;
            }

            peaks.set(binPeaks.subarray(0, available), writeOffset);
            writeOffset += available;
          }

          if (valid && writeOffset === meta.totalSamples) {
            const cached: CachedWaveform = {
              peaks,
              duration: meta.duration,
              sampleRate: meta.sampleRate,
              channels: meta.channels,
              sizeBytes: peaks.byteLength,
              lastAccessed: Date.now(),
              isComplete: true,
            };

            this.addToMemoryCache(mediaId, cached);
            this.notifyUpdate(mediaId, cached);
            return cached;
          }
        }

        logger.warn(`Invalid waveform bins for ${mediaId}; clearing and regenerating`);
        await deleteWaveformFromIndexedDB(mediaId).catch(() => {});
        return null;
      }

      // If bins exist but meta completion marker is missing, treat as interrupted decode.
      // Do not fall back to potentially stale legacy/OPFS data for this media.
      const firstBin = await getWaveformRecordFromIndexedDB(`${mediaId}:bin:0`);
      if (firstBin && 'kind' in firstBin && firstBin.kind === 'bin') {
        logger.warn(`Partial waveform bins detected without meta for ${mediaId}; regenerating`);
        await deleteWaveformFromIndexedDB(mediaId).catch(() => {});
        return null;
      }
    } catch (error) {
      logger.warn(`Failed to load binned waveform from IndexedDB: ${mediaId}`, error);
    }

    // Fallback: try OPFS.
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
      await waveformOPFSStorage.delete(mediaId).catch(() => {});
    }

    // Fallback: Try legacy IndexedDB and migrate.
    try {
      const stored = await getLegacyWaveformFromIndexedDB(mediaId);

      if (stored && stored.peaks) {
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

        this.addToMemoryCache(mediaId, cached);
        this.notifyUpdate(mediaId, cached);
        this.migrateToOPFS(mediaId, peaks, stored.duration, stored.channels).catch(() => {});

        return cached;
      }
    } catch (error) {
      logger.warn(`Failed to load legacy waveform from IndexedDB: ${mediaId}`, error);
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
      await deleteWaveformFromIndexedDB(mediaId);
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
    requestId: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    const worker = this.getWorker();

    return new Promise((resolve, reject) => {
      const pendingBinWrites: Promise<void>[] = [];
      let duration = 0;
      let channels = 1;
      let peaks: Float32Array | null = null;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        this.workerRejectors.delete(requestId);
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const resolveOnce = (waveform: CachedWaveform) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(waveform);
      };

      // Add timeout - long clips (e.g. 10+ minutes) need more processing time.
      const timeout = setTimeout(() => {
        try {
          worker.postMessage({ type: 'abort', requestId });
        } catch {
          // Ignore timeout abort post errors
        }
        if (this.worker === worker) {
          worker.terminate();
          this.worker = null;
        }
        rejectOnce(new Error('Worker timeout'));
      }, 90000);

      const handleMessage = async (event: MessageEvent<WaveformWorkerResponse>) => {
        if (event.data.requestId !== requestId) return;
        try {
          switch (event.data.type) {
            case 'progress':
              onProgress?.(event.data.progress);
              break;

            case 'init': {
              duration = event.data.duration;
              channels = event.data.channels;
              peaks = new Float32Array(event.data.totalSamples);

              const cached = this.makeCachedWaveform(peaks, duration, channels, false);
              this.addToMemoryCache(mediaId, cached);
              this.notifyUpdate(mediaId, cached);
              break;
            }

            case 'chunk': {
              if (!peaks) break;
              const { startIndex, peaks: chunkPeaks } = event.data;
              peaks.set(chunkPeaks, startIndex);

              const binIndex = Math.floor(startIndex / WAVEFORM_BIN_SAMPLES);
              const bin: WaveformBin = {
                id: `${mediaId}:bin:${binIndex}`,
                mediaId,
                kind: 'bin',
                binIndex,
                peaks: chunkPeaks.buffer as ArrayBuffer,
                samples: chunkPeaks.length,
                createdAt: Date.now(),
              };
              pendingBinWrites.push(
                saveWaveformBinToIndexedDB(bin).catch((saveError) => {
                  logger.warn(`Failed to persist waveform bin ${mediaId}:${binIndex}`, saveError);
                })
              );

              const cached = this.makeCachedWaveform(peaks, duration, channels, false);
              this.addToMemoryCache(mediaId, cached);
              this.notifyUpdate(mediaId, cached);
              break;
            }

            case 'complete': {
              if (!peaks) {
                rejectOnce(new Error('Worker completed without waveform init'));
                break;
              }

              await Promise.all(pendingBinWrites);
              if (settled) {
                break;
              }
              await saveWaveformMetaToIndexedDB({
                id: mediaId,
                mediaId,
                kind: 'meta',
                sampleRate: SAMPLES_PER_SECOND,
                totalSamples: peaks.length,
                binCount: Math.ceil(peaks.length / WAVEFORM_BIN_SAMPLES),
                binDurationSec: WAVEFORM_BIN_DURATION_SEC,
                duration,
                channels,
                createdAt: Date.now(),
              });

              const cached = this.makeCachedWaveform(peaks, duration, channels, true);
              this.addToMemoryCache(mediaId, cached);
              this.notifyUpdate(mediaId, cached);
              void this.persistToOPFS(mediaId, peaks, duration, channels);

              onProgress?.(100);
              resolveOnce(cached);
              break;
            }

            case 'error':
              rejectOnce(new Error(event.data.error));
              break;
          }
        } catch (handlerError) {
          rejectOnce(handlerError instanceof Error ? handlerError : new Error(String(handlerError)));
        }
      };

      const handleError = (event: ErrorEvent) => {
        logger.error('Waveform worker error:', event.message);
        rejectOnce(new Error(event.message || 'Worker error'));
      };

      this.workerRejectors.set(requestId, rejectOnce);
      const startWorker = async () => {
        await deleteWaveformFromIndexedDB(mediaId).catch(() => {});
        if (settled) return;

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        worker.postMessage({
          type: 'generate',
          requestId,
          blobUrl,
          samplesPerSecond: SAMPLES_PER_SECOND,
          binDurationSec: WAVEFORM_BIN_DURATION_SEC,
        });
      };
      void startWorker().catch((startError) => {
        rejectOnce(startError instanceof Error ? startError : new Error(String(startError)));
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
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<CachedWaveform> {
    if (signal?.aborted) {
      throw new AbortError();
    }
    onProgress?.(10);

    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw new AbortError();
      }
    };

    try {
      // Fetch the audio file
      const response = await fetch(blobUrl, signal ? { signal } : undefined);
      throwIfAborted();

      const arrayBuffer = await response.arrayBuffer();
      onProgress?.(30);
      throwIfAborted();

      // Decode with AudioContext
      const audioContext = new AudioContext();
      const closeContext = () => {
        void audioContext.close().catch(() => {});
      };
      signal?.addEventListener('abort', closeContext, { once: true });

      try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        onProgress?.(60);
        throwIfAborted();

        const duration = audioBuffer.duration;
        const channels = audioBuffer.numberOfChannels;

        // Mix channels to mono
        const monoSamples = new Float32Array(audioBuffer.length);
        for (let c = 0; c < channels; c++) {
          const channelData = audioBuffer.getChannelData(c);
          for (let i = 0; i < audioBuffer.length; i++) {
            monoSamples[i]! += channelData[i]! / channels;
            if ((i & 4095) === 0) {
              throwIfAborted();
            }
          }
        }
        onProgress?.(70);
        throwIfAborted();

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
          if ((i & 255) === 0) {
            throwIfAborted();
          }
        }
        onProgress?.(85);
        throwIfAborted();

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

        const cached = this.makeCachedWaveform(peaks, duration, channels, true);

        // Add to memory cache
        this.addToMemoryCache(mediaId, cached);
        this.notifyUpdate(mediaId, cached);

        await this.persistBinnedWaveform(mediaId, peaks, duration, channels).catch((saveError) => {
          logger.warn('Failed to persist waveform bins to IndexedDB:', saveError);
        });
        void this.persistToOPFS(mediaId, peaks, duration, channels);

        onProgress?.(100);
        return cached;
      } finally {
        signal?.removeEventListener('abort', closeContext);
        await audioContext.close().catch(() => {});
      }
    } catch (error) {
      if (error instanceof AbortError) {
        throw error;
      }
      if (signal?.aborted) {
        throw new AbortError();
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AbortError();
      }
      throw error;
    }
  }

  /**
   * Generate waveform with worker, falling back to AudioContext if needed
   */
  private async generateWaveform(
    mediaId: string,
    blobUrl: string,
    requestId: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    try {
      return await this.generateWaveformWithWorker(mediaId, blobUrl, requestId, onProgress);
    } catch (err) {
      if (err instanceof AbortError) {
        throw err;
      }
      logger.warn(`Waveform worker failed for ${mediaId}, falling back to AudioContext`, err);
      // Worker may fail in some environments - fallback to AudioContext
      const controller = new AbortController();
      // Fallback stores an abort trigger (not a direct Promise rejector): callers may invoke
      // `workerRejectors.get(requestId)?.(new AbortError())`, but that argument is ignored and
      // we abort via signal instead. `generateWaveformFallback` observes `controller.signal`
      // (fetch/decode) and throws AbortError from there. This differs from the worker path,
      // where the stored rejector directly rejects the pending Promise.
      const fallbackRejector = () => controller.abort();
      this.fallbackAbortControllers.set(requestId, controller);
      this.workerRejectors.set(requestId, fallbackRejector);
      try {
        return await this.generateWaveformFallback(mediaId, blobUrl, onProgress, controller.signal);
      } finally {
        const activeRejector = this.workerRejectors.get(requestId);
        if (activeRejector === fallbackRejector) {
          this.workerRejectors.delete(requestId);
        }
        const activeController = this.fallbackAbortControllers.get(requestId);
        if (activeController === controller) {
          this.fallbackAbortControllers.delete(requestId);
        }
      }
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

    // Re-check after storage load to avoid duplicate generation races.
    const pendingAfterStorage = this.pendingRequests.get(mediaId);
    if (pendingAfterStorage) {
      return pendingAfterStorage.promise;
    }

    return this.enqueueGeneration(mediaId, blobUrl, onProgress);
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
          if (error instanceof AbortError) return;
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
    if (!pending) return;

    if (pending.status === 'queued') {
      this.generationQueue = this.generationQueue.filter(
        (queued) => !(queued.mediaId === mediaId && queued.requestId === pending.requestId)
      );
      this.pendingRequests.delete(mediaId);
      pending.reject(new AbortError());
      this.processGenerationQueue();
      return;
    }

    // Running request
    if (this.worker) {
      this.worker.postMessage({
        type: 'abort',
        requestId: pending.requestId,
      });
    }
    const fallbackController = this.fallbackAbortControllers.get(pending.requestId);
    fallbackController?.abort();

    const rejector = this.workerRejectors.get(pending.requestId);
    if (rejector) {
      rejector(new AbortError());
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
    // Also clear IndexedDB waveform bins/meta (and legacy single record).
    await deleteWaveformFromIndexedDB(mediaId).catch(() => {});
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
    // Clear queue first so abort-triggered processGenerationQueue cannot start
    // new work while we're disposing.
    this.generationQueue = [];
    const pendingIds = Array.from(this.pendingRequests.keys());
    for (const mediaId of pendingIds) {
      this.abort(mediaId);
    }
    for (const controller of this.fallbackAbortControllers.values()) {
      controller.abort();
    }
    this.fallbackAbortControllers.clear();
    this.activeGenerations.clear();
    this.workerRejectors.clear();
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
