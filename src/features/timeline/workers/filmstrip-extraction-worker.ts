/**
 * Filmstrip Extraction Worker
 *
 * Extracts video frames using mediabunny's CanvasSink and saves
 * directly to OPFS as webp files. All heavy work happens in the worker.
 *
 * Storage structure:
 *   filmstrips/{mediaId}/
 *     meta.json - { width, height, isComplete, frameCount }
 *     0.webp, 1.webp, 2.webp, ...
 */

import { safeWrite } from '../utils/opfs-safe-write';

const FILMSTRIP_DIR = 'filmstrips';
const IMAGE_FORMAT = 'image/webp';
const IMAGE_QUALITY = 0.6; // Slightly lower for faster encoding
const FRAME_RATE = 1; // 1fps for filmstrip thumbnails

// Message types
export interface ExtractRequest {
  type: 'extract';
  requestId: string;
  mediaId: string;
  blobUrl: string;
  duration: number;
  width: number;
  height: number;
  skipIndices?: number[]; // Indices to skip (already extracted)
  priorityIndices?: number[]; // Indices to extract first (within the assigned range)
  // For parallel extraction - each worker handles a range
  startIndex?: number; // Start frame index (inclusive)
  endIndex?: number; // End frame index (exclusive)
  totalFrames?: number; // Total frames across all workers (for progress)
  workerId?: number; // Worker identifier for debugging
}

export interface AbortRequest {
  type: 'abort';
  requestId: string;
}

export interface ProgressResponse {
  type: 'progress';
  requestId: string;
  frameIndex: number;
  frameCount: number;
  progress: number;
}

export interface CompleteResponse {
  type: 'complete';
  requestId: string;
  frameCount: number;
}

export interface ErrorResponse {
  type: 'error';
  requestId: string;
  error: string;
}

export type WorkerRequest = ExtractRequest | AbortRequest;
export type WorkerResponse = ProgressResponse | CompleteResponse | ErrorResponse;

// Track active requests for abort support
const activeRequests = new Map<string, { aborted: boolean }>();

// Dynamically import mediabunny
const loadMediabunny = () => import('mediabunny');

/**
 * Get or create OPFS directory for filmstrip storage
 */
async function getFilmstripDir(mediaId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const filmstripRoot = await root.getDirectoryHandle(FILMSTRIP_DIR, { create: true });
  return filmstripRoot.getDirectoryHandle(mediaId, { create: true });
}

/**
 * Save a frame to OPFS
 */
async function saveFrame(
  dir: FileSystemDirectoryHandle,
  index: number,
  blob: Blob
): Promise<void> {
  const fileHandle = await dir.getFileHandle(`${index}.webp`, { create: true });
  const writable = await fileHandle.createWritable();
  await safeWrite(writable, blob);
}

/**
 * Save metadata to OPFS
 */
async function saveMetadata(
  dir: FileSystemDirectoryHandle,
  metadata: { width: number; height: number; isComplete: boolean; frameCount: number }
): Promise<void> {
  const fileHandle = await dir.getFileHandle('meta.json', { create: true });
  const writable = await fileHandle.createWritable();
  await safeWrite(writable, JSON.stringify(metadata));
}

/**
 * Extract frames and save directly to OPFS
 */
async function extractAndSave(
  request: ExtractRequest,
  state: { aborted: boolean }
): Promise<void> {
  const {
    requestId, mediaId, blobUrl, duration, width, height, skipIndices, priorityIndices,
    startIndex, endIndex, totalFrames: totalFramesOverride
  } = request;

  // Calculate frame range - support both full extraction and chunked
  const allFrames = Math.ceil(duration * FRAME_RATE);
  const rangeStart = startIndex ?? 0;
  const rangeEnd = endIndex ?? allFrames;
  const totalFrames = totalFramesOverride ?? allFrames;
  const skipSet = new Set(skipIndices || []);
  const prioritySet = new Set(priorityIndices || []);

  // Build extraction order: requested priority window first, then background remainder.
  const framesToExtract: { index: number; timestamp: number }[] = [];
  for (const index of prioritySet) {
    if (index >= rangeStart && index < rangeEnd && !skipSet.has(index)) {
      framesToExtract.push({ index, timestamp: index / FRAME_RATE });
    }
  }

  for (let i = rangeStart; i < rangeEnd; i++) {
    if (!skipSet.has(i) && !prioritySet.has(i)) {
      framesToExtract.push({ index: i, timestamp: i / FRAME_RATE });
    }
  }

  // If nothing to extract, we're done
  if (framesToExtract.length === 0) {
    self.postMessage({
      type: 'complete',
      requestId,
      frameCount: skipSet.size,
    } as CompleteResponse);
    return;
  }

  // Get OPFS directory
  const dir = await getFilmstripDir(mediaId);

  // Save initial metadata
  await saveMetadata(dir, { width, height, isComplete: false, frameCount: skipSet.size });

  // Load mediabunny
  const { Input, UrlSource, CanvasSink, ALL_FORMATS } = await loadMediabunny();

  let input: InstanceType<typeof Input> | null = null;
  let sink: InstanceType<typeof CanvasSink> | null = null;

  try {
    // Create input from blob URL
    input = new Input({
      source: new UrlSource(blobUrl),
      formats: ALL_FORMATS,
    });

    // Get primary video track
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('No video track found');
    }

    // Create CanvasSink with poolSize matching our parallel save capacity
    // This keeps VRAM constant and prevents allocation/deallocation churn
    sink = new CanvasSink(videoTrack, {
      width,
      height,
      fit: 'cover',
      poolSize: 4, // Reduced for 1fps extraction
    });

    // Track extracted frames
    let extractedCount = skipSet.size;
    let frameListIndex = 0;

    // Generator for timestamps
    async function* timestampGenerator(): AsyncGenerator<number> {
      for (const frame of framesToExtract) {
        if (state.aborted) return;
        yield frame.timestamp;
      }
    }

    // Extract and save each frame with parallel writes
    const pendingSaves: Promise<void>[] = [];
    const MAX_PARALLEL_SAVES = 4;

    for await (const wrapped of sink.canvasesAtTimestamps(timestampGenerator())) {
      if (state.aborted) break;

      const frame = framesToExtract[frameListIndex];
      if (!frame) break;

      // Skip if no frame available for this timestamp (mediabunny returns null)
      if (!wrapped) {
        frameListIndex++;
        continue;
      }

      // Convert canvas to webp blob (must await - need canvas before it's reused)
      const canvas = wrapped.canvas as OffscreenCanvas;
      const blob = await canvas.convertToBlob({
        type: IMAGE_FORMAT,
        quality: IMAGE_QUALITY,
      });

      // Save to OPFS in parallel (don't await)
      const frameIndex = frame.index;
      const savePromise = saveFrame(dir, frameIndex, blob).then(() => {
        // Remove from pending when done
        const idx = pendingSaves.indexOf(savePromise);
        if (idx > -1) pendingSaves.splice(idx, 1);
      });
      pendingSaves.push(savePromise);

      // Throttle parallel saves to prevent overwhelming OPFS
      if (pendingSaves.length >= MAX_PARALLEL_SAVES) {
        await Promise.race(pendingSaves);
      }

      extractedCount++;
      frameListIndex++;

      // Batch progress updates - report first 3, then every 10 frames
      const shouldReport = extractedCount <= 3 || extractedCount % 10 === 0;
      if (shouldReport) {
        const progress = Math.round((extractedCount / totalFrames) * 100);

        self.postMessage({
          type: 'progress',
          requestId,
          frameIndex,
          frameCount: extractedCount,
          progress: Math.min(progress, 99),
        } as ProgressResponse);
      }
    }

    // Wait for all pending saves to complete
    if (pendingSaves.length > 0) {
      await Promise.all(pendingSaves);
    }

    // Save final metadata - only mark complete when this worker range is fully covered.
    if (!state.aborted) {
      // Count only skip indices within this worker's range for accurate completion check
      let skippedInRange = 0;
      for (const idx of skipSet) {
        if (idx >= rangeStart && idx < rangeEnd) skippedInRange++;
      }
      const framesExtractedThisRun = extractedCount - skipSet.size;
      const expectedToExtract = (rangeEnd - rangeStart) - skippedInRange;
      const actuallyComplete = framesExtractedThisRun >= expectedToExtract;

      await saveMetadata(dir, {
        width,
        height,
        isComplete: actuallyComplete,
        frameCount: extractedCount,
      });

      self.postMessage({
        type: 'complete',
        requestId,
        frameCount: extractedCount,
      } as CompleteResponse);
    }
  } finally {
    // Clean up mediabunny resources to free memory
    (sink as any)?.dispose?.();
    input?.dispose();
  }
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type } = event.data;

  try {
    switch (type) {
      case 'extract': {
        const request = event.data as ExtractRequest;
        const { requestId } = request;

        const state = { aborted: false };
        activeRequests.set(requestId, state);

        try {
          await extractAndSave(request, state);
        } finally {
          activeRequests.delete(requestId);
        }
        break;
      }

      case 'abort': {
        const { requestId } = event.data as AbortRequest;
        const state = activeRequests.get(requestId);
        if (state) {
          state.aborted = true;
        }
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    const requestId = (event.data as ExtractRequest).requestId;
    self.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    } as ErrorResponse);
  }
};

export {};
