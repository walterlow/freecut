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

const FILMSTRIP_DIR = 'filmstrips';
const IMAGE_FORMAT = 'image/webp';
const IMAGE_QUALITY = 0.7;
const FRAME_RATE = 24;

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
  await writable.write(blob);
  await writable.close();
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
  await writable.write(JSON.stringify(metadata));
  await writable.close();
}

/**
 * Extract frames and save directly to OPFS
 */
async function extractAndSave(
  request: ExtractRequest,
  state: { aborted: boolean }
): Promise<void> {
  const { requestId, mediaId, blobUrl, duration, width, height, skipIndices } = request;

  console.log('[FilmstripWorker] Starting extraction:', { mediaId, duration, width, height });

  // Calculate all frame indices
  const totalFrames = Math.ceil(duration * FRAME_RATE);
  const skipSet = new Set(skipIndices || []);
  console.log('[FilmstripWorker] Total frames:', totalFrames, 'Skip:', skipSet.size);

  // Generate timestamps for frames we need to extract
  const framesToExtract: { index: number; timestamp: number }[] = [];
  for (let i = 0; i < totalFrames; i++) {
    if (!skipSet.has(i)) {
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
  const { Input, UrlSource, CanvasSink, MP4, WEBM, MATROSKA } = await loadMediabunny();

  let input: InstanceType<typeof Input> | null = null;

  try {
    // Create input from blob URL
    input = new Input({
      source: new UrlSource(blobUrl),
      formats: [MP4, WEBM, MATROSKA],
    });

    // Get primary video track
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('No video track found');
    }
    console.log('[FilmstripWorker] Got video track');

    // Create CanvasSink
    const sink = new CanvasSink(videoTrack, {
      width,
      height,
      fit: 'cover',
      poolSize: 3,
    });
    console.log('[FilmstripWorker] Created CanvasSink');

    // Track extracted frames
    let extractedCount = skipSet.size;
    let frameListIndex = 0;
    let timestampsYielded = 0;

    // Generator for timestamps
    async function* timestampGenerator(): AsyncGenerator<number> {
      for (const frame of framesToExtract) {
        if (state.aborted) return;
        timestampsYielded++;
        if (timestampsYielded <= 3) {
          console.log('[FilmstripWorker] Yielding timestamp:', frame.timestamp);
        }
        yield frame.timestamp;
      }
      console.log('[FilmstripWorker] Generator finished, yielded:', timestampsYielded);
    }

    // Extract and save each frame
    console.log('[FilmstripWorker] Starting extraction loop...');
    for await (const wrapped of sink.canvasesAtTimestamps(timestampGenerator())) {
      if (state.aborted) {
        console.log('[FilmstripWorker] Aborted');
        break;
      }

      const frame = framesToExtract[frameListIndex];
      if (!frame) break;

      // Skip if no frame available for this timestamp (mediabunny returns null)
      if (!wrapped) {
        frameListIndex++;
        continue;
      }

      // Convert canvas to webp blob
      const canvas = wrapped.canvas as OffscreenCanvas;
      const blob = await canvas.convertToBlob({
        type: IMAGE_FORMAT,
        quality: IMAGE_QUALITY,
      });

      // Save to OPFS
      await saveFrame(dir, frame.index, blob);
      extractedCount++;
      frameListIndex++;

      // Report progress
      const progress = Math.round((extractedCount / totalFrames) * 100);

      if (extractedCount <= 5 || extractedCount % 50 === 0) {
        console.log('[FilmstripWorker] Extracted frame:', frame.index, 'total:', extractedCount, 'progress:', progress);
      }

      self.postMessage({
        type: 'progress',
        requestId,
        frameIndex: frame.index,
        frameCount: extractedCount,
        progress: Math.min(progress, 99),
      } as ProgressResponse);
    }

    // Save final metadata - only mark complete if we actually have frames
    if (!state.aborted) {
      const actuallyComplete = extractedCount > 0;

      if (!actuallyComplete) {
        console.warn('[FilmstripWorker] Extraction finished but no frames extracted');
      }

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
