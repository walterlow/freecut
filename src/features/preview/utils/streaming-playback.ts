/**
 * Main-thread coordinator for WebCodecs streaming playback.
 *
 * Manages streaming decode workers and provides decoded ImageBitmaps
 * to the render pipeline as a drop-in replacement for DOM video elements.
 *
 * Usage:
 *   const playback = createStreamingPlayback();
 *   playback.startStream('blob:...', 0.5);  // start decoding from 0.5s
 *   const frame = playback.getFrame('blob:...', 1.2);  // get frame at 1.2s
 *   playback.stopStream('blob:...');
 *   playback.dispose();
 */

import { createLogger } from '@/shared/logging/logger';
import {
  getObjectUrlBlob,
  getObjectUrlDirectFileMetadata,
} from '@/infrastructure/browser/object-url-registry';
import { getKeyframeTimestamps } from '@/shared/utils/keyframe-index-registry';

const log = createLogger('StreamingPlayback');

// ---------------------------------------------------------------------------
// Frame buffer
// ---------------------------------------------------------------------------

interface BufferedFrame {
  timestamp: number;
  bitmap: ImageBitmap;
}

/** Per-source ring buffer of decoded frames. */
class FrameBuffer {
  private frames: BufferedFrame[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 30) {
    this.maxSize = maxSize;
  }

  /** Insert a frame, evicting the oldest if at capacity. */
  push(timestamp: number, bitmap: ImageBitmap): void {
    // Evict oldest if full
    if (this.frames.length >= this.maxSize) {
      const evicted = this.frames.shift();
      evicted?.bitmap.close();
    }
    this.frames.push({ timestamp, bitmap });
  }

  /**
   * Find the best frame for a target timestamp.
   * Returns the closest frame at or before the target, or the closest overall.
   */
  getFrame(targetTimestamp: number, toleranceSeconds = 0.1): BufferedFrame | null {
    if (this.frames.length === 0) return null;

    let bestBefore: BufferedFrame | null = null;
    let bestBeforeDist = Infinity;

    for (const frame of this.frames) {
      const dist = targetTimestamp - frame.timestamp;
      // Prefer frames at or just before target (within tolerance)
      if (dist >= -1e-4 && dist < bestBeforeDist) {
        bestBeforeDist = dist;
        bestBefore = frame;
      }
    }

    if (bestBefore && bestBeforeDist <= toleranceSeconds) {
      return bestBefore;
    }

    // Fallback: closest frame within tolerance
    let bestAny: BufferedFrame | null = null;
    let bestAnyDist = Infinity;
    for (const frame of this.frames) {
      const dist = Math.abs(frame.timestamp - targetTimestamp);
      if (dist < bestAnyDist) {
        bestAnyDist = dist;
        bestAny = frame;
      }
    }

    return bestAny && bestAnyDist <= toleranceSeconds ? bestAny : null;
  }

  /** Remove all frames at or before the given timestamp. */
  consumeUpTo(timestamp: number): void {
    // Keep frames near/after timestamp, close old ones
    const cutoff = timestamp - 0.2; // keep a small lookback buffer
    const kept: BufferedFrame[] = [];
    for (const frame of this.frames) {
      if (frame.timestamp < cutoff) {
        frame.bitmap.close();
      } else {
        kept.push(frame);
      }
    }
    this.frames = kept;
  }

  /** Flush all frames. */
  clear(): void {
    for (const frame of this.frames) {
      frame.bitmap.close();
    }
    this.frames = [];
  }

  get size(): number {
    return this.frames.length;
  }

  get oldestTimestamp(): number | null {
    return this.frames.length > 0 ? this.frames[0]!.timestamp : null;
  }

  get newestTimestamp(): number | null {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1]!.timestamp : null;
  }
}

// ---------------------------------------------------------------------------
// Source state
// ---------------------------------------------------------------------------

interface SourceInfo {
  width: number;
  height: number;
  duration: number;
}

interface StreamState {
  buffer: FrameBuffer;
  info: SourceInfo | null;
  streaming: boolean;
  lastConsumedTimestamp: number | null;
}

// ---------------------------------------------------------------------------
// Streaming playback coordinator
// ---------------------------------------------------------------------------

export interface StreamingPlayback {
  /** Start streaming decode for a source from a given timestamp. */
  startStream(src: string, startTimestamp: number): void;
  /** Seek an active stream to a new timestamp. */
  seekStream(src: string, timestamp: number): void;
  /** Stop streaming for a source. */
  stopStream(src: string): void;
  /** Stop all active streams. */
  stopAll(): void;
  /** Get the best decoded frame for a source at a target timestamp. Returns null if no frame available. */
  getFrame(src: string, targetTimestamp: number): ImageBitmap | null;
  /** Get source info (dimensions, duration) if available. */
  getSourceInfo(src: string): SourceInfo | null;
  /** Whether a source is actively streaming. */
  isStreaming(src: string): boolean;
  /** Dispose all resources. */
  dispose(): void;

  /** Metrics for debugging. */
  getMetrics(): StreamingPlaybackMetrics;
}

export interface StreamingPlaybackMetrics {
  activeStreams: number;
  totalFramesReceived: number;
  totalFramesDrawn: number;
  totalFramesMissed: number;
  bufferSizes: Map<string, number>;
}

export function createStreamingPlayback(): StreamingPlayback {
  let worker: Worker | null = null;
  let workerReady = false;
  const streams = new Map<string, StreamState>();
  const pendingStarts: Array<() => void> = [];

  // Metrics
  let totalFramesReceived = 0;
  let totalFramesDrawn = 0;
  let totalFramesMissed = 0;

  // Blob cache (same pattern as decoder-prewarm.ts)
  const blobByUrl = new Map<string, Blob>();

  function ensureWorker(): Worker {
    if (worker) return worker;

    worker = new Worker(
      new URL('../workers/streaming-decode-worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = handleWorkerMessage;
    worker.onerror = (error) => {
      log.warn('Streaming decode worker error', { message: error.message });
    };
    worker.postMessage({ type: 'warmup' });

    return worker;
  }

  function handleWorkerMessage(event: MessageEvent): void {
    const msg = event.data;

    if (msg.type === 'ready') {
      workerReady = true;
      // Flush pending starts
      for (const fn of pendingStarts) fn();
      pendingStarts.length = 0;
      return;
    }

    if (msg.type === 'source_ready') {
      const state = streams.get(msg.src);
      if (state) {
        state.info = {
          width: msg.width,
          height: msg.height,
          duration: msg.duration,
        };
      }
      return;
    }

    if (msg.type === 'frame') {
      const state = streams.get(msg.src);
      if (!state) return;

      totalFramesReceived++;

      if (msg.bitmap instanceof ImageBitmap) {
        state.buffer.push(msg.timestamp, msg.bitmap);
      }

      // Acknowledge consumption for backpressure
      worker?.postMessage({ type: 'frame_consumed', src: msg.src });
      return;
    }

    if (msg.type === 'stream_ended') {
      const state = streams.get(msg.src);
      if (state) {
        state.streaming = false;
      }
      return;
    }

    if (msg.type === 'keyframes_extracted') {
      // Could forward to main-thread registry if needed
      return;
    }

    if (msg.type === 'error') {
      log.warn('Streaming decode error', { src: msg.src, message: msg.message });
      return;
    }
  }

  function getOrCreateState(src: string): StreamState {
    const existing = streams.get(src);
    if (existing) return existing;
    const state: StreamState = {
      buffer: new FrameBuffer(30),
      info: null,
      streaming: false,
      lastConsumedTimestamp: null,
    };
    streams.set(src, state);
    return state;
  }

  function resolveBlobForWorker(src: string): Blob | undefined {
    const cached = blobByUrl.get(src);
    if (cached) return cached;

    const registered = getObjectUrlBlob(src);
    if (registered) {
      blobByUrl.set(src, registered);
      return registered;
    }

    return undefined;
  }

  function buildStartMessage(src: string, startTimestamp: number) {
    const sourceMetadata = getObjectUrlDirectFileMetadata(src) ?? undefined;
    const blob = sourceMetadata ? undefined : resolveBlobForWorker(src);
    const keyframeTimestamps = getKeyframeTimestamps(src);

    return {
      type: 'stream_start' as const,
      src,
      startTimestamp,
      blob,
      sourceMetadata,
      keyframeTimestamps,
    };
  }

  return {
    startStream(src: string, startTimestamp: number): void {
      const state = getOrCreateState(src);
      state.buffer.clear();
      state.streaming = true;
      state.lastConsumedTimestamp = null;

      const w = ensureWorker();
      const msg = buildStartMessage(src, startTimestamp);

      if (workerReady) {
        w.postMessage(msg);
      } else {
        pendingStarts.push(() => w.postMessage(msg));
      }
    },

    seekStream(src: string, timestamp: number): void {
      const state = streams.get(src);
      if (!state) return;

      state.buffer.clear();
      state.streaming = true;
      state.lastConsumedTimestamp = null;

      worker?.postMessage({
        type: 'stream_seek',
        src,
        timestamp,
      });
    },

    stopStream(src: string): void {
      const state = streams.get(src);
      if (!state) return;

      state.streaming = false;
      worker?.postMessage({ type: 'stream_stop', src });
    },

    stopAll(): void {
      for (const [src, state] of streams) {
        if (state.streaming) {
          state.streaming = false;
          worker?.postMessage({ type: 'stream_stop', src });
        }
      }
    },

    getFrame(src: string, targetTimestamp: number): ImageBitmap | null {
      const state = streams.get(src);
      if (!state) {
        totalFramesMissed++;
        return null;
      }

      const frame = state.buffer.getFrame(targetTimestamp);
      if (!frame) {
        totalFramesMissed++;
        return null;
      }

      totalFramesDrawn++;
      state.lastConsumedTimestamp = targetTimestamp;

      // Prune old frames that we've passed
      state.buffer.consumeUpTo(targetTimestamp);

      return frame.bitmap;
    },

    getSourceInfo(src: string): SourceInfo | null {
      return streams.get(src)?.info ?? null;
    },

    isStreaming(src: string): boolean {
      return streams.get(src)?.streaming ?? false;
    },

    dispose(): void {
      for (const [, state] of streams) {
        state.buffer.clear();
      }
      streams.clear();
      blobByUrl.clear();

      if (worker) {
        worker.terminate();
        worker = null;
        workerReady = false;
      }
    },

    getMetrics(): StreamingPlaybackMetrics {
      const bufferSizes = new Map<string, number>();
      for (const [src, state] of streams) {
        bufferSizes.set(src, state.buffer.size);
      }
      return {
        activeStreams: [...streams.values()].filter((s) => s.streaming).length,
        totalFramesReceived,
        totalFramesDrawn,
        totalFramesMissed,
        bufferSizes,
      };
    },
  };
}
