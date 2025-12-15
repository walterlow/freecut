/**
 * Filmstrip Worker Pool
 *
 * Manages a pool of workers for parallel filmstrip extraction.
 * Distributes timestamps across workers using interleaved distribution
 * for fastest time-to-first-frame.
 *
 * Features:
 * - Lazy initialization (workers created on first use)
 * - Interleaved timestamp distribution
 * - Progressive frame streaming to caller
 * - Playback-aware throttling (reduces workers when video is playing)
 * - Abort support
 */
import { createLogger } from '@/lib/logger';

const logger = createLogger('FilmstripWorkerPool');

import type {
  WorkerRequest,
  WorkerResponse,
  FrameResponse,
  ErrorResponse,
} from '../workers/filmstrip-extraction-worker';
import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from '@/features/timeline/constants';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';

// Use 2 workers to reduce decoder contention with playback
// 4 concurrent decoders can cause stuttering
const WORKER_COUNT = 2;
const TARGET_FRAME_INTERVAL = 1 / 24; // ~24 frames per second

// Throttle frame processing during playback to prevent jank
const PLAYBACK_THROTTLE_MS = 50; // Process frames every 50ms during playback

interface PendingFrame {
  timestamp: number;
  bitmap: ImageBitmap;
}

interface PendingExtraction {
  mediaId: string;
  onFrame: (timestamp: number, bitmap: ImageBitmap) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  completedWorkers: number;
  totalWorkers: number;
  hasError: boolean;
  // Frame queue for throttled processing during playback
  frameQueue: PendingFrame[];
  isProcessingQueue: boolean;
}

class FilmstripWorkerPool {
  private workers: Worker[] = [];
  private initialized = false;
  private pendingExtractions = new Map<string, PendingExtraction>();

  /**
   * Check if video is currently playing (for throttling)
   */
  private isPlaying(): boolean {
    return usePlaybackStore.getState().isPlaying;
  }

  /**
   * Process queued frames with throttling during playback
   */
  private processFrameQueue(pending: PendingExtraction): void {
    if (pending.isProcessingQueue || pending.frameQueue.length === 0) {
      return;
    }

    pending.isProcessingQueue = true;

    const processNextBatch = () => {
      // Process frames in batches
      const batchSize = this.isPlaying() ? 1 : 5; // Smaller batches during playback
      const batch = pending.frameQueue.splice(0, batchSize);

      for (const frame of batch) {
        pending.onFrame(frame.timestamp, frame.bitmap);
      }

      if (pending.frameQueue.length > 0) {
        // Schedule next batch
        if (this.isPlaying()) {
          // During playback, use setTimeout with delay to yield to decoder
          setTimeout(processNextBatch, PLAYBACK_THROTTLE_MS);
        } else if ('requestIdleCallback' in self) {
          // When not playing, use idle callback for smooth processing
          requestIdleCallback(processNextBatch, { timeout: 100 });
        } else {
          // Fallback to setTimeout
          setTimeout(processNextBatch, 0);
        }
      } else {
        pending.isProcessingQueue = false;
      }
    };

    // Start processing
    if (this.isPlaying()) {
      setTimeout(processNextBatch, PLAYBACK_THROTTLE_MS);
    } else {
      processNextBatch();
    }
  }

  /**
   * Lazy initialization - workers created on first extract() call
   */
  private ensureWorkers(): void {
    if (this.initialized) return;
    this.initialized = true;

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(
        new URL('../workers/filmstrip-extraction-worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (e: MessageEvent<WorkerResponse>) =>
        this.handleWorkerMessage(e.data);
      worker.onerror = (e) => this.handleWorkerError(e);
      this.workers.push(worker);
    }
  }

  /**
   * Extract filmstrip frames using parallel workers
   *
   * @param config.mediaId - Unique identifier for the media
   * @param config.blobUrl - Blob URL for the video file
   * @param config.duration - Video duration in seconds
   * @param config.onFrame - Called for each extracted frame
   * @param config.onComplete - Called when all workers complete
   * @param config.onError - Called on error
   * @returns Request ID for abort support
   */
  extract(config: {
    mediaId: string;
    blobUrl: string;
    duration: number;
    onFrame: (timestamp: number, bitmap: ImageBitmap) => void;
    onComplete: () => void;
    onError: (error: Error) => void;
  }): string {
    this.ensureWorkers();

    const { mediaId, blobUrl, duration, onFrame, onComplete, onError } = config;

    // Generate all timestamps at TARGET_FRAME_INTERVAL
    const timestamps: number[] = [];
    for (let t = 0; t < duration; t += TARGET_FRAME_INTERVAL) {
      timestamps.push(t);
    }

    // Distribute interleaved across workers
    // Worker 0: [t0, t4, t8...], Worker 1: [t1, t5, t9...], etc.
    const distributions = this.distributeInterleaved(timestamps);

    // Generate unique request ID
    const requestId = crypto.randomUUID();

    // Track pending extraction
    this.pendingExtractions.set(requestId, {
      mediaId,
      onFrame,
      onComplete,
      onError,
      completedWorkers: 0,
      totalWorkers: WORKER_COUNT,
      hasError: false,
      frameQueue: [],
      isProcessingQueue: false,
    });

    // Start all workers in parallel
    distributions.forEach((workerTimestamps, i) => {
      const request: WorkerRequest = {
        type: 'extract',
        requestId,
        blobUrl,
        timestamps: workerTimestamps,
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
      };
      this.workers[i]!.postMessage(request);
    });

    return requestId;
  }

  /**
   * Abort an in-progress extraction
   */
  abort(requestId: string): void {
    // Send abort to all workers
    for (const worker of this.workers) {
      worker.postMessage({ type: 'abort', requestId });
    }

    // Clean up pending extraction
    this.pendingExtractions.delete(requestId);
  }

  /**
   * Distribute timestamps across workers using interleaved pattern
   * This ensures fastest time-to-first-frame and progressive appearance
   */
  private distributeInterleaved(timestamps: number[]): number[][] {
    const distributions: number[][] = Array.from(
      { length: WORKER_COUNT },
      () => []
    );

    timestamps.forEach((ts, i) => {
      distributions[i % WORKER_COUNT]!.push(ts);
    });

    return distributions;
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(response: WorkerResponse): void {
    const { type, requestId } = response;
    const pending = this.pendingExtractions.get(requestId);

    if (!pending) {
      // Request was aborted or already completed
      // Close any transferred bitmaps to free memory
      if (type === 'frame') {
        (response as FrameResponse).bitmap.close();
      }
      return;
    }

    switch (type) {
      case 'frame': {
        const { timestamp, bitmap } = response as FrameResponse;
        // Queue frame for throttled processing
        pending.frameQueue.push({ timestamp, bitmap });
        this.processFrameQueue(pending);
        break;
      }

      case 'complete': {
        pending.completedWorkers++;

        // All workers completed
        if (pending.completedWorkers === pending.totalWorkers) {
          // Wait for frame queue to drain before calling onComplete
          const waitForQueueDrain = () => {
            if (pending.frameQueue.length === 0 && !pending.isProcessingQueue) {
              this.pendingExtractions.delete(requestId);
              if (!pending.hasError) {
                pending.onComplete();
              }
            } else {
              setTimeout(waitForQueueDrain, 10);
            }
          };
          waitForQueueDrain();
        }
        break;
      }

      case 'error': {
        const { error } = response as ErrorResponse;

        // Only report first error
        if (!pending.hasError) {
          pending.hasError = true;
          pending.onError(new Error(error));
        }

        pending.completedWorkers++;

        // Clean up when all workers done (even if errored)
        if (pending.completedWorkers === pending.totalWorkers) {
          // Close any queued bitmaps
          for (const frame of pending.frameQueue) {
            frame.bitmap.close();
          }
          this.pendingExtractions.delete(requestId);
        }
        break;
      }
    }
  }

  /**
   * Handle worker errors (uncaught exceptions)
   */
  private handleWorkerError(event: ErrorEvent): void {
    logger.error('Filmstrip worker error:', event.message);
  }

  /**
   * Dispose all workers and clean up
   */
  dispose(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.initialized = false;
    this.pendingExtractions.clear();
  }
}

// Singleton instance
export const filmstripWorkerPool = new FilmstripWorkerPool();

// Re-export constants for consumers
export { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT };
