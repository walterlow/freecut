/**
 * Filmstrip Extraction Worker
 *
 * Extracts video frames using mediabunny's CanvasSink and saves
 * directly to OPFS. All heavy work happens in the worker.
 *
 * Storage structure:
 *   filmstrips/{mediaId}/
 *     meta.json - { width, height, isComplete, frameCount }
 *     0.jpg, 1.jpg, 2.jpg, ... (legacy caches may still include .webp)
 */

import { safeWrite } from '../utils/opfs-safe-write';

const FILMSTRIP_DIR = 'filmstrips';
const IMAGE_FORMAT = 'image/jpeg';
const IMAGE_QUALITY = 0.7; // JPEG is substantially faster to encode for tiny thumbnails
const FRAME_FILE_EXT = 'jpg';
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
  targetIndices?: number[]; // Optional explicit extraction indices for this worker
  // For parallel extraction - each worker handles a range
  startIndex?: number; // Start frame index (inclusive)
  endIndex?: number; // End frame index (exclusive)
  totalFrames?: number; // Total frames across all workers (for progress)
  workerId?: number; // Worker identifier for debugging
  maxParallelSaves?: number; // Optional memory-pressure throttle from main thread
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
  savedFrames: Array<{
    index: number;
    blob: Blob;
  }>;
  savedIndices: number[];
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

function getRequestIdFromMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return 'unknown';
  const maybe = data as { requestId?: unknown };
  return typeof maybe.requestId === 'string' ? maybe.requestId : 'unknown';
}

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
  const fileHandle = await dir.getFileHandle(`${index}.${FRAME_FILE_EXT}`, { create: true });
  const writable = await fileHandle.createWritable();
  await safeWrite(writable, blob);
}

/**
 * Extract frames and save directly to OPFS
 */
async function extractAndSave(
  request: ExtractRequest,
  state: { aborted: boolean }
): Promise<void> {
  const {
    requestId, mediaId, blobUrl, duration, width, height, skipIndices, priorityIndices, targetIndices,
    startIndex, endIndex, totalFrames: totalFramesOverride, maxParallelSaves
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

  const hasExplicitTargets = Array.isArray(targetIndices) && targetIndices.length > 0;
  const explicitTargets = hasExplicitTargets
    ? targetIndices
      .filter((index) => index >= rangeStart && index < rangeEnd)
      .sort((a, b) => a - b)
    : [];
  const targetSet = new Set(explicitTargets);
  const initialCompletedCount = hasExplicitTargets
    ? explicitTargets.reduce((count, index) => (skipSet.has(index) ? count + 1 : count), 0)
    : Array.from(skipSet).reduce(
      (count, index) => (index >= rangeStart && index < rangeEnd ? count + 1 : count),
      0
    );

  for (const index of prioritySet) {
    const inRange = index >= rangeStart && index < rangeEnd;
    const inTarget = !hasExplicitTargets || targetSet.has(index);
    if (inRange && inTarget && !skipSet.has(index)) {
      framesToExtract.push({ index, timestamp: index / FRAME_RATE });
    }
  }

  if (hasExplicitTargets) {
    for (const index of explicitTargets) {
      if (!skipSet.has(index) && !prioritySet.has(index)) {
        framesToExtract.push({ index, timestamp: index / FRAME_RATE });
      }
    }
  } else {
    for (let i = rangeStart; i < rangeEnd; i++) {
      if (!skipSet.has(i) && !prioritySet.has(i)) {
        framesToExtract.push({ index: i, timestamp: i / FRAME_RATE });
      }
    }
  }

  // If nothing to extract, we're done
  if (framesToExtract.length === 0) {
    self.postMessage({
      type: 'complete',
      requestId,
      frameCount: initialCompletedCount,
    } as CompleteResponse);
    return;
  }

  // Get OPFS directory
  const dir = await getFilmstripDir(mediaId);

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
    let extractedCount = initialCompletedCount;
    let frameListIndex = 0;
    let savedSinceLastReport: Array<{ index: number; blob: Blob }> = [];

    // Generator for timestamps
    async function* timestampGenerator(): AsyncGenerator<number> {
      for (const frame of framesToExtract) {
        if (state.aborted) return;
        yield frame.timestamp;
      }
    }

    // Extract and save each frame with parallel writes
    const pendingSaves: Promise<void>[] = [];
    const MAX_PARALLEL_SAVES = Math.max(1, Math.min(6, maxParallelSaves ?? 4));

    for await (const wrapped of sink.canvasesAtTimestamps(timestampGenerator())) {
      if (state.aborted) break;

      const frame = framesToExtract[frameListIndex];
      if (!frame) break;

      // Skip if no frame available for this timestamp (mediabunny returns null)
      if (!wrapped) {
        frameListIndex++;
        continue;
      }

      // Convert canvas to image blob (must await - need canvas before it's reused)
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
        savedSinceLastReport.push({ index: frameIndex, blob });
      });
      pendingSaves.push(savePromise);

      // Throttle parallel saves to prevent overwhelming OPFS
      if (pendingSaves.length >= MAX_PARALLEL_SAVES) {
        await Promise.race(pendingSaves);
      }

      extractedCount++;
      frameListIndex++;

      // extractedCount tracks decoded/extracted frames immediately, while
      // savedFrames/savedIndices only include writes that have finished.
      // pendingSaves + Promise.race throttle OPFS writes, so progress reflects
      // extraction and persistence completion can lag briefly behind it.
      // Batch progress updates - report first 3, then every 10 frames
      const shouldReport = extractedCount <= 3 || extractedCount % 10 === 0;
      if (shouldReport) {
        const progress = Math.round((extractedCount / totalFrames) * 100);
        const savedFrames = savedSinceLastReport;
        savedSinceLastReport = [];
        const savedIndices = savedFrames.map((entry) => entry.index);

        self.postMessage({
          type: 'progress',
          requestId,
          frameIndex,
          frameCount: extractedCount,
          progress: Math.min(progress, 99),
          savedFrames,
          savedIndices,
        } as ProgressResponse);
      }
    }

    // Wait for all pending saves to complete
    if (pendingSaves.length > 0) {
      await Promise.all(pendingSaves);
    }

    // Emit any saved frames that completed after the final progress report.
    if (savedSinceLastReport.length > 0) {
      const progress = Math.round((extractedCount / totalFrames) * 100);
      const savedFrames = savedSinceLastReport;
      const savedIndices = savedFrames.map((entry) => entry.index);
      self.postMessage({
        type: 'progress',
        requestId,
        frameIndex: framesToExtract[Math.max(0, frameListIndex - 1)]?.index ?? rangeStart,
        frameCount: extractedCount,
        progress: Math.min(progress, 99),
        savedFrames,
        savedIndices,
      } as ProgressResponse);
      savedSinceLastReport = [];
    }

    // Main thread is responsible for writing final "isComplete=true" metadata once
    // all workers finish to avoid cross-worker completion races.
    if (!state.aborted) {
      self.postMessage({
        type: 'complete',
        requestId,
        frameCount: extractedCount,
      } as CompleteResponse);
    }
  } finally {
    // Clean up mediabunny resources to free memory
    (sink as unknown as { dispose?: () => void } | null)?.dispose?.();
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
    const requestId = getRequestIdFromMessage(event.data);
    self.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    } as ErrorResponse);
  }
};

export {};
