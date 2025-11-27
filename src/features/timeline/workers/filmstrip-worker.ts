/**
 * Filmstrip Worker - Web Worker for extracting video frames
 *
 * Extracts frames from video at specified timestamps and returns them
 * as Blobs (for IndexedDB storage) or ImageBitmaps (for immediate rendering).
 */

import type { FilmstripDensity } from '@/types/storage';

// Density tier configuration
const DENSITY_CONFIG = {
  low: { interval: 2 }, // 1 frame every 2 seconds
  medium: { interval: 0.5 }, // 1 frame every 0.5 seconds
  high: { interval: 0.2 }, // 1 frame every 0.2 seconds
} as const;

export interface FilmstripWorkerRequest {
  type: 'extract-frames' | 'abort';
  payload: {
    requestId: string;
    mediaId?: string;
    blobUrl?: string;
    density?: FilmstripDensity;
    duration?: number; // Video duration in seconds
    width?: number; // Thumbnail width (default: 71)
    height?: number; // Thumbnail height (default: 40)
    quality?: number; // JPEG quality 0-1 (default: 0.7)
    returnType?: 'blob' | 'imageBitmap'; // What to return
  };
}

export interface FilmstripWorkerResponse {
  type: 'frames-ready' | 'progress' | 'error' | 'aborted';
  payload: {
    requestId: string;
    mediaId?: string;
    density?: FilmstripDensity;
    frames?: Blob[] | ImageBitmap[];
    timestamps?: number[];
    width?: number;
    height?: number;
    progress?: number; // 0-100
    error?: string;
  };
}

// Track active requests for abort support
const activeRequests = new Map<string, { aborted: boolean }>();

/**
 * Calculate frame timestamps based on density tier
 */
function calculateTimestamps(duration: number, density: FilmstripDensity): number[] {
  const config = DENSITY_CONFIG[density];
  const timestamps: number[] = [];

  // Always include first frame
  timestamps.push(0.1); // Slight offset to avoid black frames

  const interval = config.interval;
  let time = interval;

  while (time < duration) {
    timestamps.push(time);
    time += interval;
  }

  return timestamps;
}

/**
 * Extract a single frame from video at specified time
 */
async function extractFrame(
  video: HTMLVideoElement,
  time: number,
  width: number,
  height: number,
  quality: number,
  returnType: 'blob' | 'imageBitmap'
): Promise<Blob | ImageBitmap> {
  // Seek to the target time
  video.currentTime = time;

  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error(`Failed to seek to time ${time}`));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
  });

  // Use OffscreenCanvas for worker-safe rendering
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get 2D context');
  }

  // Draw the video frame
  ctx.drawImage(video, 0, 0, width, height);

  if (returnType === 'imageBitmap') {
    return canvas.transferToImageBitmap();
  } else {
    // Convert to JPEG blob
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality,
    });
    return blob;
  }
}

/**
 * Extract all frames for a video
 */
async function extractFrames(
  requestId: string,
  blobUrl: string,
  duration: number,
  density: FilmstripDensity,
  width: number,
  height: number,
  quality: number,
  returnType: 'blob' | 'imageBitmap',
  port: MessagePort
): Promise<{ frames: (Blob | ImageBitmap)[]; timestamps: number[] }> {
  const requestState = activeRequests.get(requestId);
  if (!requestState) {
    throw new Error('Request not found');
  }

  // Create video element
  const video = document.createElement('video');
  video.src = blobUrl;
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  // Wait for video to be ready
  await new Promise<void>((resolve, reject) => {
    const onLoadedData = () => {
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
      reject(new Error('Failed to load video'));
    };
    video.addEventListener('loadeddata', onLoadedData, { once: true });
    video.addEventListener('error', onError, { once: true });
  });

  // Calculate timestamps
  const timestamps = calculateTimestamps(duration, density);
  const frames: (Blob | ImageBitmap)[] = [];

  // Extract frames with progress reporting
  for (let i = 0; i < timestamps.length; i++) {
    // Check for abort
    if (requestState.aborted) {
      // Clean up and throw
      video.src = '';
      throw new Error('Aborted');
    }

    const timestamp = timestamps[i]!;
    const frame = await extractFrame(video, timestamp, width, height, quality, returnType);
    frames.push(frame);

    // Report progress
    const progress = Math.round(((i + 1) / timestamps.length) * 100);
    const progressResponse: FilmstripWorkerResponse = {
      type: 'progress',
      payload: {
        requestId,
        progress,
      },
    };
    port.postMessage(progressResponse);
  }

  // Clean up video element
  video.src = '';

  return { frames, timestamps };
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent<FilmstripWorkerRequest>) => {
  const { type, payload } = event.data;
  const port = event.ports[0];

  if (!port) {
    console.error('No message port provided');
    return;
  }

  try {
    switch (type) {
      case 'extract-frames': {
        const {
          requestId,
          mediaId,
          blobUrl,
          density = 'medium',
          duration,
          width = 71,
          height = 40,
          quality = 0.7,
          returnType = 'blob',
        } = payload;

        if (!requestId || !blobUrl || !duration) {
          throw new Error('Missing required parameters: requestId, blobUrl, duration');
        }

        // Track this request for abort support
        activeRequests.set(requestId, { aborted: false });

        try {
          const { frames, timestamps } = await extractFrames(
            requestId,
            blobUrl,
            duration,
            density,
            width,
            height,
            quality,
            returnType,
            port
          );

          const response: FilmstripWorkerResponse = {
            type: 'frames-ready',
            payload: {
              requestId,
              mediaId,
              density,
              frames: returnType === 'imageBitmap'
                ? (frames as ImageBitmap[])
                : (frames as Blob[]),
              timestamps,
              width,
              height,
            },
          };

          // Transfer ImageBitmaps if applicable
          if (returnType === 'imageBitmap') {
            port.postMessage(response, frames as ImageBitmap[]);
          } else {
            port.postMessage(response);
          }
        } finally {
          activeRequests.delete(requestId);
        }
        break;
      }

      case 'abort': {
        const { requestId } = payload;
        const requestState = activeRequests.get(requestId);
        if (requestState) {
          requestState.aborted = true;
        }

        const response: FilmstripWorkerResponse = {
          type: 'aborted',
          payload: { requestId },
        };
        port.postMessage(response);
        break;
      }

      default:
        throw new Error(`Unknown action type: ${type}`);
    }
  } catch (error) {
    const response: FilmstripWorkerResponse = {
      type: 'error',
      payload: {
        requestId: payload.requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    };
    port.postMessage(response);
  }
};

// Export for TypeScript module
export {};
