/**
 * Waveform Cache Service
 *
 * Manages waveform data caching with:
 * - In-memory LRU cache for fast access
 * - IndexedDB persistence across sessions
 * - Mediabunny-based waveform generation (hardware-accelerated)
 */

import type { WaveformData } from '@/types/storage';
import { getWaveform, saveWaveform, deleteWaveform, reconnectDB } from '@/lib/storage/indexeddb';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WaveformCache');

// Lazy load mediabunny to avoid blocking initial render
const mediabunnyModule = () => import('mediabunny');

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

interface ExtractionState {
  aborted: boolean;
}

class WaveformCacheService {
  private memoryCache = new Map<string, CachedWaveform>();
  private currentCacheSize = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private activeExtractions = new Map<string, ExtractionState>();

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
        logger.warn('IndexedDB schema outdated, attempting reconnection...');
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
          logger.error('Failed to load waveform after reconnection:', retryError);
        }
      } else {
        logger.error(`Failed to load waveform from IndexedDB: ${mediaId}`, error);
      }
      return null;
    }
  }

  /**
   * Generate waveform using mediabunny (hardware-accelerated WebCodecs)
   */
  private async generateWaveform(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<CachedWaveform> {
    const extractionState: ExtractionState = { aborted: false };
    this.activeExtractions.set(mediaId, extractionState);

    // Load mediabunny
    const mediabunny = await mediabunnyModule();
    const { Input, UrlSource, AudioSampleSink, MP4, WEBM, MATROSKA, MP3, WAVE, FLAC, OGG } = mediabunny;

    try {
      onProgress?.(5);

      // Create input from blob URL with common audio/video formats
      const input = new Input({
        source: new UrlSource(blobUrl),
        formats: [MP4, WEBM, MATROSKA, MP3, WAVE, FLAC, OGG],
      });

      // Get primary audio track
      const audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) {
        throw new Error('No audio track found');
      }

      onProgress?.(10);

      // Get audio metadata
      const sampleRate = audioTrack.sampleRate;
      const channels = audioTrack.numberOfChannels;
      const duration = await audioTrack.computeDuration();

      // Create audio sample sink for sample extraction
      const sink = new AudioSampleSink(audioTrack);

      // Collect all audio samples
      const allSamples: Float32Array[] = [];
      let totalSamples = 0;

      onProgress?.(20);

      try {
        for await (const sample of sink.samples()) {
          if (extractionState.aborted) {
            sample.close();
            throw new Error('Aborted');
          }

          // Convert to AudioBuffer
          const buffer = sample.toAudioBuffer();
          sample.close(); // Release sample resources

          // Get samples from all channels and mix to mono
          const channelData: Float32Array[] = [];
          for (let c = 0; c < buffer.numberOfChannels; c++) {
            channelData.push(buffer.getChannelData(c));
          }

          // Mix to mono by averaging channels
          const monoSamples = new Float32Array(buffer.length);
          for (let i = 0; i < buffer.length; i++) {
            let sum = 0;
            for (let c = 0; c < channelData.length; c++) {
              sum += channelData[c]![i] ?? 0;
            }
            monoSamples[i] = sum / channelData.length;
          }

          allSamples.push(monoSamples);
          totalSamples += buffer.length;

          // Update progress
          const progress = 20 + Math.min(60, Math.round((totalSamples / (sampleRate * duration)) * 60));
          onProgress?.(progress);
        }
      } catch (loopError) {
        if (extractionState.aborted) {
          throw new Error('Aborted');
        }
        throw loopError;
      }

      onProgress?.(80);

      // Combine all samples into one array
      const combinedSamples = new Float32Array(totalSamples);
      let offset = 0;
      for (const samples of allSamples) {
        combinedSamples.set(samples, offset);
        offset += samples.length;
      }

      // Downsample to target samples per second
      const numOutputSamples = Math.ceil(duration * SAMPLES_PER_SECOND);
      const samplesPerOutput = Math.floor(totalSamples / numOutputSamples);
      const peaks = new Float32Array(numOutputSamples);

      // Extract peak values
      for (let i = 0; i < numOutputSamples; i++) {
        const startIdx = i * samplesPerOutput;
        const endIdx = Math.min(startIdx + samplesPerOutput, totalSamples);

        let maxVal = 0;
        for (let j = startIdx; j < endIdx; j++) {
          const val = Math.abs(combinedSamples[j] ?? 0);
          if (val > maxVal) {
            maxVal = val;
          }
        }
        peaks[i] = maxVal;
      }

      // Normalize to 0-1 range
      let maxPeak = 0;
      for (let i = 0; i < peaks.length; i++) {
        if (peaks[i]! > maxPeak) {
          maxPeak = peaks[i]!;
        }
      }
      if (maxPeak > 0) {
        for (let i = 0; i < peaks.length; i++) {
          peaks[i] = peaks[i]! / maxPeak;
        }
      }

      onProgress?.(90);

      const cached: CachedWaveform = {
        peaks,
        duration,
        sampleRate: SAMPLES_PER_SECOND,
        channels,
        sizeBytes: peaks.buffer.byteLength,
        lastAccessed: Date.now(),
      };

      // Add to memory cache
      this.addToMemoryCache(mediaId, cached);

      // Persist to IndexedDB
      try {
        const waveformData: WaveformData = {
          id: mediaId,
          mediaId,
          peaks: peaks.buffer as ArrayBuffer,
          duration,
          sampleRate: SAMPLES_PER_SECOND,
          channels,
          createdAt: Date.now(),
        };
        await saveWaveform(waveformData);
      } catch (saveError) {
        logger.warn('Failed to persist waveform to IndexedDB:', saveError);
      }

      onProgress?.(100);
      return cached;
    } finally {
      this.activeExtractions.delete(mediaId);
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
          logger.warn('Waveform prefetch failed:', error);
        });
      }
    });
  }

  /**
   * Abort pending generation for a media item
   */
  abort(mediaId: string): void {
    const extraction = this.activeExtractions.get(mediaId);
    if (extraction) {
      extraction.aborted = true;
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
   * Cleanup
   */
  dispose(): void {
    this.clearAll();
    // Abort all active extractions
    for (const extraction of this.activeExtractions.values()) {
      extraction.aborted = true;
    }
    this.activeExtractions.clear();
  }
}

// Singleton instance
export const waveformCache = new WaveformCacheService();
