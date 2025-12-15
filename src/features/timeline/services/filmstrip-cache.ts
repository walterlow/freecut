/**
 * Filmstrip Cache Service
 *
 * Simple service that:
 * 1. Manages extraction worker
 * 2. Provides object URLs from OPFS storage
 * 3. Notifies subscribers when new frames are available
 *
 * No ImageBitmaps in memory - just URLs for <img> tags.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('FilmstripCache');

import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from '@/features/timeline/constants';
import { filmstripOPFSStorage, type FilmstripFrame, type LoadedFilmstrip } from './filmstrip-opfs-storage';
import type { ExtractRequest, WorkerResponse } from '../workers/filmstrip-extraction-worker';

export { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT };
export type { FilmstripFrame };

export interface Filmstrip {
  frames: FilmstripFrame[];
  isComplete: boolean;
  isExtracting: boolean;
  progress: number;
}

export type FilmstripUpdateCallback = (filmstrip: Filmstrip) => void;

interface PendingExtraction {
  requestId: string;
  mediaId: string;
  worker: Worker;
  onProgress?: (progress: number) => void;
  // Track frames incrementally during extraction
  extractedFrames: Map<number, FilmstripFrame>;
}

class FilmstripCacheService {
  private cache = new Map<string, Filmstrip>();
  private pendingExtractions = new Map<string, PendingExtraction>();
  private updateCallbacks = new Map<string, Set<FilmstripUpdateCallback>>();
  private loadingPromises = new Map<string, Promise<Filmstrip>>();

  /**
   * Subscribe to filmstrip updates
   */
  subscribe(mediaId: string, callback: FilmstripUpdateCallback): () => void {
    if (!this.updateCallbacks.has(mediaId)) {
      this.updateCallbacks.set(mediaId, new Set());
    }
    this.updateCallbacks.get(mediaId)!.add(callback);

    // Immediately call with current state if available
    const current = this.cache.get(mediaId);
    if (current) {
      callback(current);
    }

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

  private notifyUpdate(mediaId: string, filmstrip: Filmstrip): void {
    this.cache.set(mediaId, filmstrip);
    const callbacks = this.updateCallbacks.get(mediaId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(filmstrip);
      }
    }
  }

  /**
   * Get filmstrip - loads from storage and starts extraction if needed
   */
  async getFilmstrip(
    mediaId: string,
    blobUrl: string,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<Filmstrip> {
    // Return cached if complete
    const cached = this.cache.get(mediaId);
    if (cached?.isComplete && !cached.isExtracting) {
      return cached;
    }

    // Check for pending load
    const loading = this.loadingPromises.get(mediaId);
    if (loading) {
      return loading;
    }

    const promise = this.loadAndExtract(mediaId, blobUrl, duration, onProgress);
    this.loadingPromises.set(mediaId, promise);

    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(mediaId);
    }
  }

  private async loadAndExtract(
    mediaId: string,
    blobUrl: string,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<Filmstrip> {
    // Try loading from storage
    const stored = await filmstripOPFSStorage.load(mediaId);

    if (stored?.metadata.isComplete) {
      // Complete - return immediately
      const filmstrip: Filmstrip = {
        frames: stored.frames,
        isComplete: true,
        isExtracting: false,
        progress: 100,
      };
      this.notifyUpdate(mediaId, filmstrip);
      return filmstrip;
    }

    // Notify with existing frames (if any)
    const existingFrames = stored?.frames || [];
    const existingIndices = stored?.existingIndices || [];

    const initialFilmstrip: Filmstrip = {
      frames: existingFrames,
      isComplete: false,
      isExtracting: true,
      progress: existingFrames.length > 0 ? Math.round((existingFrames.length / Math.ceil(duration * 24)) * 100) : 0,
    };
    this.notifyUpdate(mediaId, initialFilmstrip);

    // Start extraction (pass existing frames to avoid reloading)
    this.startExtraction(mediaId, blobUrl, duration, existingIndices, existingFrames, onProgress);

    return initialFilmstrip;
  }

  private startExtraction(
    mediaId: string,
    blobUrl: string,
    duration: number,
    skipIndices: number[],
    existingFrames: FilmstripFrame[],
    onProgress?: (progress: number) => void
  ): void {
    // Check if already extracting
    if (this.pendingExtractions.has(mediaId)) {
      return;
    }

    const requestId = crypto.randomUUID();
    const worker = new Worker(
      new URL('../workers/filmstrip-extraction-worker.ts', import.meta.url),
      { type: 'module' }
    );

    // Initialize with existing frames (passed from loadAndExtract)
    const extractedFrames = new Map<number, FilmstripFrame>();
    for (const frame of existingFrames) {
      extractedFrames.set(frame.index, frame);
    }

    this.pendingExtractions.set(mediaId, { requestId, mediaId, worker, onProgress, extractedFrames });

    worker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
      const response = e.data;
      const pending = this.pendingExtractions.get(mediaId);

      if (response.type === 'progress') {
        onProgress?.(response.progress);

        // Load only the new frame incrementally instead of reloading all
        if (pending) {
          const newFrame = await filmstripOPFSStorage.loadSingleFrame(mediaId, response.frameIndex);
          if (newFrame) {
            pending.extractedFrames.set(response.frameIndex, newFrame);

            // Convert map to sorted array
            const frames = Array.from(pending.extractedFrames.values())
              .sort((a, b) => a.index - b.index);

            logger.debug(`Incremental update for ${mediaId}: frame ${response.frameIndex}, total: ${frames.length}`);

            this.notifyUpdate(mediaId, {
              frames,
              isComplete: false,
              isExtracting: true,
              progress: response.progress,
            });
          }
        }
      } else if (response.type === 'complete') {
        // Reload final state
        const final = await filmstripOPFSStorage.load(mediaId);
        this.notifyUpdate(mediaId, {
          frames: final?.frames || [],
          isComplete: true,
          isExtracting: false,
          progress: 100,
        });
        onProgress?.(100);
        this.cleanupExtraction(mediaId);
        logger.debug(`Filmstrip ${mediaId} complete: ${response.frameCount} frames`);
      } else if (response.type === 'error') {
        logger.error(`Filmstrip extraction error: ${response.error}`);
        this.cleanupExtraction(mediaId);
      }
    };

    worker.onerror = (e) => {
      logger.error('Worker error:', e.message);
      this.cleanupExtraction(mediaId);
    };

    // Send extraction request
    const request: ExtractRequest = {
      type: 'extract',
      requestId,
      mediaId,
      blobUrl,
      duration,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      skipIndices: skipIndices.length > 0 ? skipIndices : undefined,
    };
    worker.postMessage(request);

    logger.debug(`Started extraction for ${mediaId}, skipping ${skipIndices.length} frames`);
  }

  private cleanupExtraction(mediaId: string): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (pending) {
      pending.worker.terminate();
      this.pendingExtractions.delete(mediaId);
    }
  }

  /**
   * Abort extraction
   */
  abort(mediaId: string): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (pending) {
      pending.worker.postMessage({ type: 'abort', requestId: pending.requestId });
      this.cleanupExtraction(mediaId);
    }
  }

  /**
   * Get synchronously from cache (for avoiding flash on remount)
   */
  getFromCacheSync(mediaId: string): Filmstrip | null {
    return this.cache.get(mediaId) || null;
  }

  /**
   * Clear filmstrip for a media item
   */
  async clearMedia(mediaId: string): Promise<void> {
    this.abort(mediaId);
    this.cache.delete(mediaId);
    await filmstripOPFSStorage.delete(mediaId);
  }

  /**
   * Clear all
   */
  async clearAll(): Promise<void> {
    for (const mediaId of this.pendingExtractions.keys()) {
      this.abort(mediaId);
    }
    this.cache.clear();
    await filmstripOPFSStorage.clearAll();
  }

  /**
   * Dispose
   */
  dispose(): void {
    for (const mediaId of this.pendingExtractions.keys()) {
      this.abort(mediaId);
    }
    this.cache.clear();
    this.updateCallbacks.clear();
    this.loadingPromises.clear();
  }
}

// Singleton
export const filmstripCache = new FilmstripCacheService();

// Debug access
(window as any).__filmstripCache = filmstripCache;
