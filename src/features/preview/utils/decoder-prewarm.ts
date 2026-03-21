/**
 * Main-thread manager for the decoder prewarm Web Worker.
 *
 * Sends pre-seek requests to a background worker that runs mediabunny WASM
 * decode off the main thread. The worker returns decoded ImageBitmaps that
 * the render loop can draw directly — zero main-thread WASM work.
 *
 * This eliminates the 300-500ms keyframe seek stall when occluded variable-
 * speed clips become visible mid-playback.
 */

import { createLogger } from '@/shared/logging/logger';

const log = createLogger('DecoderPrewarm');

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<string, {
  resolve: (bitmap: ImageBitmap | null) => void;
}>();

/** Cache of pre-decoded bitmaps keyed by video source URL. Multiple entries per source. */
const bitmapCache = new Map<string, Array<{ bitmap: ImageBitmap; timestamp: number }>>();

// Dev: expose cache for debugging
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__PREWARM_CACHE__ = bitmapCache;
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    log.info('Creating decoder prewarm worker');
    worker = new Worker(
      new URL('../workers/decoder-prewarm-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      log.info('Worker response', { type: msg.type, id: msg.id, success: msg.success, hasBitmap: !!msg.bitmap, error: msg.error });
      if (msg.type === 'preseek_done') {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          pending.resolve(msg.bitmap ?? null);
        }
      }
    };
    worker.onerror = (error) => {
      log.warn('Decoder prewarm worker error', { message: error.message, filename: error.filename, lineno: error.lineno });
    };
    worker.addEventListener('messageerror', (e) => {
      log.warn('Decoder prewarm worker message error', { data: e.data });
    });
    return worker;
  } catch (error) {
    log.warn('Failed to create decoder prewarm worker', { error });
    return null;
  }
}

/**
 * Pre-decode a video frame in a background Web Worker.
 * Returns the decoded ImageBitmap or null on failure.
 * The bitmap is also cached by source URL for the render loop to use.
 */
export function backgroundPreseek(src: string, timestamp: number): Promise<ImageBitmap | null> {
  log.info('backgroundPreseek called', { src: src.substring(src.length - 20), timestamp: Math.round(timestamp * 100) / 100 });
  const w = ensureWorker();
  if (!w) {
    log.warn('Worker not available');
    return Promise.resolve(null);
  }

  const id = `preseek-${++requestId}`;
  return new Promise<ImageBitmap | null>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(null);
    }, 5000);

    pendingRequests.set(id, {
      resolve: (bitmap) => {
        clearTimeout(timeout);
        if (bitmap) {
          // Cache the bitmap for the render loop
          const entries = bitmapCache.get(src) ?? [];
          entries.push({ bitmap, timestamp });
          // Keep at most 6 cached entries per source
          while (entries.length > 6) {
            const old = entries.shift();
            old?.bitmap.close();
          }
          bitmapCache.set(src, entries);
        }
        resolve(bitmap);
      },
    });

    w.postMessage({ type: 'preseek', id, src, timestamp });
  });
}

/**
 * Get a pre-decoded bitmap from the cache for a video source.
 * Returns the bitmap if it exists and is for a nearby timestamp.
 */
export function getCachedPredecodedBitmap(src: string, timestamp: number, toleranceSeconds = 0.5): ImageBitmap | null {
  const entries = bitmapCache.get(src);
  if (!entries || entries.length === 0) return null;
  // Find the closest entry within tolerance
  let best: { bitmap: ImageBitmap; timestamp: number } | null = null;
  let bestDist = Infinity;
  for (const entry of entries) {
    const dist = Math.abs(entry.timestamp - timestamp);
    if (dist <= toleranceSeconds && dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best?.bitmap ?? null;
}

/**
 * Clear cached bitmaps for a source.
 */
export function clearPredecodedCache(src?: string): void {
  if (src) {
    const entries = bitmapCache.get(src);
    if (entries) {
      for (const entry of entries) entry.bitmap.close();
    }
    bitmapCache.delete(src);
  } else {
    for (const entries of bitmapCache.values()) {
      for (const entry of entries) entry.bitmap.close();
    }
    bitmapCache.clear();
  }
}

/**
 * Dispose the worker and clean up.
 */
export function disposePrewarmWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const pending of pendingRequests.values()) {
    pending.resolve(null);
  }
  pendingRequests.clear();
  clearPredecodedCache();
}
