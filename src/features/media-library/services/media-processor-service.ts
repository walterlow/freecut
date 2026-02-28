/**
 * Media Processor Service
 *
 * Manages the media processor worker for off-main-thread media processing.
 * Provides a simple async API for extracting metadata and generating thumbnails.
 */

import { createLogger } from '@/shared/logging/logger';
import type {
  ProcessMediaRequest,
  ProcessMediaResponse,
  VideoMetadata,
  AudioMetadata,
  ImageMetadata,
} from '../workers/media-processor.worker';

const logger = createLogger('MediaProcessorService');

type MediaMetadataResult = VideoMetadata | AudioMetadata | ImageMetadata;

interface ProcessMediaResult {
  metadata: MediaMetadataResult;
  thumbnail?: Blob;
}

interface PendingRequest {
  resolve: (result: ProcessMediaResult) => void;
  reject: (error: Error) => void;
}

class MediaProcessorService {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private workerReady = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the worker (lazy)
   */
  private async ensureWorker(): Promise<Worker> {
    if (this.worker && this.workerReady) {
      return this.worker;
    }

    if (this.initPromise) {
      await this.initPromise;
      return this.worker!;
    }

    this.initPromise = new Promise<void>((resolve) => {
      this.worker = new Worker(
        new URL('../workers/media-processor.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<ProcessMediaResponse>) => {
        this.handleMessage(event.data);
      };

      this.worker.onerror = (event) => {
        logger.error('Media processor worker error:', event.message);
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error(`Worker error: ${event.message}`));
          this.pendingRequests.delete(id);
        }
      };

      this.workerReady = true;
      resolve();
    });

    await this.initPromise;
    return this.worker!;
  }

  /**
   * Handle messages from the worker
   */
  private handleMessage(response: ProcessMediaResponse): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) {
      logger.warn('Received response for unknown request:', response.requestId);
      return;
    }

    this.pendingRequests.delete(response.requestId);

    if (response.type === 'error') {
      pending.reject(new Error(response.error || 'Unknown error'));
    } else if (response.type === 'complete' && response.metadata) {
      pending.resolve({
        metadata: response.metadata,
        thumbnail: response.thumbnail,
      });
    } else {
      pending.reject(new Error('Invalid response from worker'));
    }
  }

  /**
   * Process a media file - extract metadata and generate thumbnail
   *
   * This runs entirely off the main thread to prevent UI blocking.
   *
   * @param file - The media file to process
   * @param mimeType - The MIME type of the file
   * @param options - Optional processing options
   * @returns Promise with metadata and thumbnail
   */
  async processMedia(
    file: File,
    mimeType: string,
    options?: {
      thumbnailMaxSize?: number;
      thumbnailQuality?: number;
      thumbnailTimestamp?: number;
    }
  ): Promise<ProcessMediaResult> {
    const worker = await this.ensureWorker();
    const requestId = `media-${++this.requestId}`;

    return new Promise<ProcessMediaResult>((resolve, reject) => {
      // Set timeout for processing (30 seconds max)
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Media processing timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      const request: ProcessMediaRequest = {
        type: 'process',
        requestId,
        file,
        mimeType,
        options,
      };

      worker.postMessage(request);
    });
  }

  /**
   * Process multiple files in parallel (up to concurrency limit)
   *
   * @param files - Array of files with their MIME types
   * @param concurrency - Max concurrent processing (default 3)
   * @param onProgress - Progress callback
   * @returns Array of results in same order as input
   */
  async processMediaBatch(
    files: Array<{ file: File; mimeType: string }>,
    concurrency = 3,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Array<ProcessMediaResult | Error>> {
    const results: Array<ProcessMediaResult | Error> = new Array(files.length);
    let completed = 0;

    // Process in chunks for controlled concurrency
    const chunks: Array<Array<{ index: number; file: File; mimeType: string }>> = [];
    for (let i = 0; i < files.length; i += concurrency) {
      chunks.push(
        files.slice(i, i + concurrency).map((f, j) => ({
          index: i + j,
          ...f,
        }))
      );
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(({ file, mimeType }) => this.processMedia(file, mimeType))
      );

      for (let i = 0; i < chunkResults.length; i++) {
        const result = chunkResults[i];
        const chunkItem = chunk[i];
        if (!result || !chunkItem) continue;

        const originalIndex = chunkItem.index;

        if (result.status === 'fulfilled') {
          results[originalIndex] = result.value;
        } else {
          // result.status === 'rejected'
          const reason = result.reason as Error | undefined;
          results[originalIndex] = new Error(reason?.message || 'Processing failed');
        }

        completed++;
        onProgress?.(completed, files.length);
      }
    }

    return results;
  }

  /**
   * Check if a video file has unsupported audio codec
   * This is now included in the metadata extraction - no separate call needed
   */
  hasUnsupportedAudioCodec(metadata: MediaMetadataResult): { unsupported: boolean; codec?: string } {
    if (metadata.type === 'video') {
      return {
        unsupported: !metadata.audioCodecSupported,
        codec: metadata.audioCodec,
      };
    }
    return { unsupported: false };
  }

  /**
   * Terminate the worker
   */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
      this.initPromise = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Worker disposed'));
      this.pendingRequests.delete(id);
    }
  }
}

// Singleton instance
export const mediaProcessorService = new MediaProcessorService();

