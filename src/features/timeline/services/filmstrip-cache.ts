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
import { filmstripOPFSStorage, type FilmstripFrame } from './filmstrip-opfs-storage';
import type { ExtractRequest, WorkerResponse } from '../workers/filmstrip-extraction-worker';

export { THUMBNAIL_WIDTH };
export type { FilmstripFrame };

export interface Filmstrip {
  frames: FilmstripFrame[];
  isComplete: boolean;
  isExtracting: boolean;
  progress: number;
}

type FilmstripUpdateCallback = (filmstrip: Filmstrip) => void;

// Configuration for parallel extraction
const FRAME_RATE = 1; // Must match worker - 1fps for filmstrip thumbnails
const MIN_FRAMES_PER_WORKER = 30; // Don't spawn workers for tiny chunks
const MAX_WORKERS = 2; // Limit parallel workers (reduced for 1fps)
const IMAGE_FORMAT = 'image/webp';
const IMAGE_QUALITY = 0.6;

interface WorkerState {
  worker: Worker;
  requestId: string;
  startIndex: number;
  endIndex: number;
  completed: boolean;
  frameCount: number;
}

interface PendingExtraction {
  mediaId: string;
  blobUrl: string;
  duration: number;
  skipIndices: number[];
  forceSingleWorker: boolean;
  fallbackAttempted: boolean;
  isVideoFallback: boolean;
  workers: WorkerState[];
  totalFrames: number;
  completedWorkers: number;
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
    onProgress?: (progress: number) => void,
    forceSingleWorker = false
  ): void {
    // Check if already extracting
    if (this.pendingExtractions.has(mediaId)) {
      return;
    }

    // Calculate total frames and worker count
    const totalFrames = Math.ceil(duration * FRAME_RATE);
    const skipSet = new Set(skipIndices);
    const framesToExtract = totalFrames - skipSet.size;

    // Determine number of workers based on frame count
    const maxWorkers = forceSingleWorker ? 1 : MAX_WORKERS;
    const workerCount = Math.min(
      maxWorkers,
      Math.max(1, Math.floor(framesToExtract / MIN_FRAMES_PER_WORKER))
    );

    // Initialize with existing frames
    const extractedFrames = new Map<number, FilmstripFrame>();
    for (const frame of existingFrames) {
      extractedFrames.set(frame.index, frame);
    }

    // Create pending extraction state
    const pending: PendingExtraction = {
      mediaId,
      blobUrl,
      duration,
      skipIndices,
      forceSingleWorker,
      fallbackAttempted: false,
      isVideoFallback: false,
      workers: [],
      totalFrames,
      completedWorkers: 0,
      onProgress,
      extractedFrames,
    };
    this.pendingExtractions.set(mediaId, pending);

    // Calculate frame ranges for each worker
    const framesPerWorker = Math.ceil(totalFrames / workerCount);

    logger.info(`Starting ${workerCount} workers for ${mediaId} (${totalFrames} frames)`);

    for (let i = 0; i < workerCount; i++) {
      const startIndex = i * framesPerWorker;
      const endIndex = Math.min((i + 1) * framesPerWorker, totalFrames);

      if (startIndex >= totalFrames) break;

      const requestId = crypto.randomUUID();
      const worker = new Worker(
        new URL('../workers/filmstrip-extraction-worker.ts', import.meta.url),
        { type: 'module' }
      );

      const workerState: WorkerState = {
        worker,
        requestId,
        startIndex,
        endIndex,
        completed: false,
        frameCount: 0,
      };
      pending.workers.push(workerState);

      // Handle worker messages
      worker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
        const response = e.data;

        if (response.type === 'progress') {
          workerState.frameCount = response.frameCount;

          // Calculate overall progress from all workers
          const totalExtracted = pending.workers.reduce((sum, w) => sum + w.frameCount, 0);
          const overallProgress = Math.round((totalExtracted / totalFrames) * 100);
          onProgress?.(overallProgress);

          // Load new frames from this worker's range
          await this.loadNewFrames(mediaId, workerState.startIndex, response.frameCount);

          // Notify with current state
          const frames = Array.from(pending.extractedFrames.values())
            .sort((a, b) => a.index - b.index);

          this.notifyUpdate(mediaId, {
            frames,
            isComplete: false,
            isExtracting: true,
            progress: overallProgress,
          });

        } else if (response.type === 'complete') {
          workerState.completed = true;
          workerState.frameCount = response.frameCount;
          pending.completedWorkers++;

          logger.debug(`Worker ${i} complete: ${response.frameCount} frames`);

          // Check if all workers are done
          if (pending.completedWorkers === pending.workers.length) {
            // All workers done - reload final state
            const final = await filmstripOPFSStorage.load(mediaId);
            this.notifyUpdate(mediaId, {
              frames: final?.frames || [],
              isComplete: true,
              isExtracting: false,
              progress: 100,
            });
            onProgress?.(100);
            this.cleanupExtraction(mediaId);
            logger.info(`Filmstrip ${mediaId} complete: ${final?.frames.length || 0} frames`);
          }

        } else if (response.type === 'error') {
          if (this.shouldRetryWithSingleWorker(response.error)) {
            logger.warn(`Worker ${i} decode error: ${response.error}`);
          } else {
            logger.error(`Worker ${i} error: ${response.error}`);
          }
          this.handleWorkerError(mediaId, response.error);
        }
      };

      worker.onerror = (e) => {
        if (this.shouldRetryWithSingleWorker(e.message)) {
          logger.warn(`Worker ${i} decode error: ${e.message}`);
        } else {
          logger.error(`Worker ${i} error:`, e.message);
        }
        this.handleWorkerError(mediaId, e.message);
      };

      // Send extraction request with range
      const request: ExtractRequest = {
        type: 'extract',
        requestId,
        mediaId,
        blobUrl,
        duration,
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        skipIndices: skipIndices.filter(idx => idx >= startIndex && idx < endIndex),
        startIndex,
        endIndex,
        totalFrames,
        workerId: i,
      };
      worker.postMessage(request);
    }
  }

  private async loadNewFrames(
    mediaId: string,
    workerStartIndex: number,
    workerFrameCount: number
  ): Promise<void> {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending) return;

    // Load frames from this worker's range that we don't have yet
    const framesToLoad: number[] = [];
    for (let i = workerStartIndex; i < workerStartIndex + workerFrameCount; i++) {
      if (!pending.extractedFrames.has(i)) {
        framesToLoad.push(i);
      }
    }

    if (framesToLoad.length > 0) {
      // Load up to 20 frames in parallel
      const loadPromises = framesToLoad.slice(0, 20).map(async (index) => {
        const frame = await filmstripOPFSStorage.loadSingleFrame(mediaId, index);
        if (frame) {
          pending.extractedFrames.set(index, frame);
        }
      });
      await Promise.all(loadPromises);
    }
  }

  private shouldRetryWithSingleWorker(error: string): boolean {
    const normalized = error.toLowerCase();
    return normalized.includes('key frame is required after configure() or flush()')
      || normalized.includes('marked as type `key` but wasn\'t a key frame');
  }

  private startVideoElementFallback(
    mediaId: string,
    blobUrl: string,
    duration: number,
    skipIndices: number[],
    existingFrames: FilmstripFrame[],
    onProgress?: (progress: number) => void
  ): void {
    if (this.pendingExtractions.has(mediaId)) {
      return;
    }

    const totalFrames = Math.ceil(duration * FRAME_RATE);
    const extractedFrames = new Map<number, FilmstripFrame>();
    for (const frame of existingFrames) {
      extractedFrames.set(frame.index, frame);
    }

    const pending: PendingExtraction = {
      mediaId,
      blobUrl,
      duration,
      skipIndices,
      forceSingleWorker: true,
      fallbackAttempted: true,
      isVideoFallback: true,
      workers: [],
      totalFrames,
      completedWorkers: 0,
      onProgress,
      extractedFrames,
    };

    this.pendingExtractions.set(mediaId, pending);
    logger.warn(`Falling back to HTMLVideoElement extraction for ${mediaId}`);

    void this.extractWithVideoElement(mediaId);
  }

  private async extractWithVideoElement(mediaId: string): Promise<void> {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending || !pending.isVideoFallback) return;

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    try {
      video.src = pending.blobUrl;
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          reject(new Error('Failed to load video metadata for filmstrip fallback'));
        };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
      });

      const canvas = document.createElement('canvas');
      canvas.width = THUMBNAIL_WIDTH;
      canvas.height = THUMBNAIL_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to create canvas context for filmstrip fallback');
      }

      const totalFrames = pending.totalFrames;
      const skipSet = new Set<number>([
        ...pending.skipIndices,
        ...Array.from(pending.extractedFrames.keys()),
      ]);

      await filmstripOPFSStorage.saveMetadata(mediaId, {
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        isComplete: false,
        frameCount: pending.extractedFrames.size,
      });

      for (let i = 0; i < totalFrames; i++) {
        const currentPending = this.pendingExtractions.get(mediaId);
        if (!currentPending || !currentPending.isVideoFallback) {
          return;
        }

        if (skipSet.has(i)) {
          continue;
        }

        const maxSeekTime = Math.max(0, video.duration - 0.01);
        const targetTime = Math.min(i / FRAME_RATE, maxSeekTime);

        await this.seekVideo(video, targetTime);
        this.drawCoverFrame(video, ctx, canvas.width, canvas.height);

        const blob = await this.canvasToBlob(canvas);
        await filmstripOPFSStorage.saveFrameBlob(mediaId, i, blob);

        const frame = await filmstripOPFSStorage.loadSingleFrame(mediaId, i);
        if (frame) {
          currentPending.extractedFrames.set(i, frame);
        }

        const extractedCount = currentPending.extractedFrames.size;
        const overallProgress = totalFrames > 0
          ? Math.round((extractedCount / totalFrames) * 100)
          : 100;
        currentPending.onProgress?.(overallProgress);

        if (extractedCount <= 3 || extractedCount % 10 === 0 || extractedCount === totalFrames) {
          const frames = Array.from(currentPending.extractedFrames.values())
            .sort((a, b) => a.index - b.index);
          this.notifyUpdate(mediaId, {
            frames,
            isComplete: false,
            isExtracting: true,
            progress: overallProgress,
          });
        }
      }

      const finishedPending = this.pendingExtractions.get(mediaId);
      if (!finishedPending || !finishedPending.isVideoFallback) {
        return;
      }

      await filmstripOPFSStorage.saveMetadata(mediaId, {
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        isComplete: true,
        frameCount: finishedPending.extractedFrames.size,
      });

      const final = await filmstripOPFSStorage.load(mediaId);
      this.notifyUpdate(mediaId, {
        frames: final?.frames || [],
        isComplete: true,
        isExtracting: false,
        progress: 100,
      });
      finishedPending.onProgress?.(100);
      this.cleanupExtraction(mediaId);
      logger.info(`Filmstrip ${mediaId} complete via video fallback: ${final?.frames.length || 0} frames`);
    } catch (error) {
      logger.error(`Video fallback extraction failed for ${mediaId}:`, error);

      const currentPending = this.pendingExtractions.get(mediaId);
      const frames = currentPending
        ? Array.from(currentPending.extractedFrames.values()).sort((a, b) => a.index - b.index)
        : [];

      this.notifyUpdate(mediaId, {
        frames,
        isComplete: false,
        isExtracting: false,
        progress: 0,
      });
      this.cleanupExtraction(mediaId);
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  private async seekVideo(video: HTMLVideoElement, targetTime: number): Promise<void> {
    const clamped = Math.max(0, targetTime);
    if (Math.abs(video.currentTime - clamped) < 0.001) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        reject(new Error('Video seek failed during filmstrip fallback'));
      };

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.currentTime = clamped;
    });
  }

  private drawCoverFrame(
    video: HTMLVideoElement,
    ctx: CanvasRenderingContext2D,
    targetWidth: number,
    targetHeight: number
  ): void {
    const sourceWidth = video.videoWidth || targetWidth;
    const sourceHeight = video.videoHeight || targetHeight;

    const sourceAspect = sourceWidth / sourceHeight;
    const targetAspect = targetWidth / targetHeight;

    let drawWidth = targetWidth;
    let drawHeight = targetHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (sourceAspect > targetAspect) {
      drawHeight = targetHeight;
      drawWidth = drawHeight * sourceAspect;
      offsetX = (targetWidth - drawWidth) / 2;
    } else {
      drawWidth = targetWidth;
      drawHeight = drawWidth / sourceAspect;
      offsetY = (targetHeight - drawHeight) / 2;
    }

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error('Failed to convert filmstrip fallback canvas to blob'));
        },
        IMAGE_FORMAT,
        IMAGE_QUALITY
      );
    });
  }

  private handleWorkerError(mediaId: string, error = ''): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending) return;

    // Keep any frames we have
    const currentFrames = Array.from(pending.extractedFrames.values())
      .sort((a, b) => a.index - b.index);

    if (
      !pending.forceSingleWorker
      && !pending.fallbackAttempted
      && this.shouldRetryWithSingleWorker(error)
    ) {
      logger.warn(`Retrying filmstrip extraction for ${mediaId} with a single worker`);

      const skipIndices = Array.from(new Set([
        ...pending.skipIndices,
        ...currentFrames.map(frame => frame.index),
      ]));

      pending.fallbackAttempted = true;
      this.cleanupExtraction(mediaId);
      this.startExtraction(
        mediaId,
        pending.blobUrl,
        pending.duration,
        skipIndices,
        currentFrames,
        pending.onProgress,
        true
      );
      return;
    }

    if (pending.forceSingleWorker && !pending.isVideoFallback && this.shouldRetryWithSingleWorker(error)) {
      logger.warn(`Single-worker decode failed for ${mediaId}; switching to video element fallback`);

      const skipIndices = Array.from(new Set([
        ...pending.skipIndices,
        ...currentFrames.map(frame => frame.index),
      ]));

      this.cleanupExtraction(mediaId);
      this.startVideoElementFallback(
        mediaId,
        pending.blobUrl,
        pending.duration,
        skipIndices,
        currentFrames,
        pending.onProgress
      );
      return;
    }

    this.notifyUpdate(mediaId, {
      frames: currentFrames,
      isComplete: false,
      isExtracting: false,
      progress: 0,
    });
    this.cleanupExtraction(mediaId);
  }

  private cleanupExtraction(mediaId: string): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (pending) {
      // Terminate all workers
      for (const workerState of pending.workers) {
        workerState.worker.terminate();
      }
      this.pendingExtractions.delete(mediaId);
    }
  }

  /**
   * Abort extraction
   */
  abort(mediaId: string): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (pending) {
      // Send abort to all workers
      for (const workerState of pending.workers) {
        workerState.worker.postMessage({ type: 'abort', requestId: workerState.requestId });
      }
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

declare global {
  interface Window {
    __filmstripCache?: FilmstripCacheService;
  }
}

if (import.meta.env.DEV) {
  window.__filmstripCache = filmstripCache;
}
