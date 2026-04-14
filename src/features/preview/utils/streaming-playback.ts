/**
 * Main-thread coordinator for WebCodecs streaming playback.
 *
 * Manages streaming decode workers and provides decoded ImageBitmaps
 * to the render pipeline as a drop-in replacement for DOM video elements.
 *
 * Key behaviors:
 * - Lazy auto-start: getFrame() for an unknown source triggers async stream init
 * - Backpressure: frame_consumed signals are sent on draw, not receive
 * - Idle cleanup: sources not requested for IDLE_TIMEOUT_MS are stopped
 *
 * Usage:
 *   const playback = createStreamingPlayback();
 *   playback.startStream('blob:...', 0.5);
 *   const frame = playback.getFrame('blob:...', 1.2);
 *   playback.stopAll();
 *   playback.dispose();
 */

import { createLogger } from '@/shared/logging/logger';
import {
  getObjectUrlBlob,
  getObjectUrlDirectFileMetadata,
} from '@/infrastructure/browser/object-url-registry';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { getKeyframeTimestamps } from '@/shared/utils/keyframe-index-registry';

const log = createLogger('StreamingPlayback');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long a source can go without getFrame() calls before being stopped. */
const IDLE_TIMEOUT_MS = 3000;
/** How often to run the idle cleanup sweep. */
const IDLE_SWEEP_INTERVAL_MS = 1000;
/** Maximum frames buffered per source. */
const MAX_BUFFER_SIZE = 30;
/** Source time tolerance for frame lookup (seconds). */
const FRAME_TOLERANCE_SECONDS = 0.15;

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

  constructor(maxSize = MAX_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  /** Insert a frame, evicting the oldest if at capacity. */
  push(timestamp: number, bitmap: ImageBitmap): void {
    if (this.frames.length >= this.maxSize) {
      const evicted = this.frames.shift();
      evicted?.bitmap.close();
    }
    this.frames.push({ timestamp, bitmap });
  }

  /**
   * Find the best frame for a target timestamp.
   * Prefers the closest frame at or just before the target.
   */
  getFrame(targetTimestamp: number, toleranceSeconds = FRAME_TOLERANCE_SECONDS): BufferedFrame | null {
    if (this.frames.length === 0) return null;

    // Best match: closest frame at or just before target within tolerance
    let bestBefore: BufferedFrame | null = null;
    let bestBeforeDist = Infinity;

    for (const frame of this.frames) {
      const dist = targetTimestamp - frame.timestamp;
      if (dist >= -1e-4 && dist < bestBeforeDist) {
        bestBeforeDist = dist;
        bestBefore = frame;
      }
    }

    if (bestBefore && bestBeforeDist <= toleranceSeconds) {
      return bestBefore;
    }

    // When the worker is behind (decode startup), show the newest frame we have
    // rather than nothing. A slightly stale frame is better than a blank canvas.
    if (bestBefore) {
      return bestBefore;
    }

    // Fallback: closest frame overall (handles slightly-ahead frames during seek)
    return this.frames[this.frames.length - 1] ?? null;
  }

  /** Remove frames well behind the playback position. */
  pruneOld(currentTimestamp: number): number {
    const cutoff = currentTimestamp - 0.2; // keep a small lookback
    let pruned = 0;
    const kept: BufferedFrame[] = [];
    for (const frame of this.frames) {
      if (frame.timestamp < cutoff) {
        frame.bitmap.close();
        pruned++;
      } else {
        kept.push(frame);
      }
    }
    this.frames = kept;
    return pruned;
  }

  clear(): void {
    for (const frame of this.frames) {
      frame.bitmap.close();
    }
    this.frames = [];
  }

  get size(): number {
    return this.frames.length;
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
  /** Frames received from worker but not yet drawn. Used for backpressure. */
  undrawnCount: number;
  /** Timestamp (ms) of the last getFrame() call. Used for idle cleanup. */
  lastAccessMs: number;
  /** Whether a lazy auto-start is already in flight. */
  autoStartPending: boolean;
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
  /**
   * Get the best decoded frame for a source at a target timestamp.
   * If no stream exists for this source, lazily starts one and returns null.
   * Falls through to the next render path (DOM video) until frames arrive.
   */
  getFrame(src: string, targetTimestamp: number, mediaId?: string): ImageBitmap | null;
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
  let disposed = false;
  const streams = new Map<string, StreamState>();
  const pendingStarts: Array<() => void> = [];

  // Metrics
  let totalFramesReceived = 0;
  let totalFramesDrawn = 0;
  let totalFramesMissed = 0;

  // Blob cache (same pattern as decoder-prewarm.ts)
  const blobByUrl = new Map<string, Blob>();

  // Idle sweep timer
  let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

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
    // eslint-disable-next-line no-console
    console.log('[StreamingPlayback:msg]', msg?.type, msg?.type === 'frame' ? { ts: msg.timestamp, hasBitmap: msg.bitmap instanceof ImageBitmap } : msg);

    if (msg.type === 'ready') {
      diag('worker ready');
      workerReady = true;
      for (const fn of pendingStarts) fn();
      pendingStarts.length = 0;
      return;
    }

    if (msg.type === 'debug') {
      // eslint-disable-next-line no-console
      console.log('[StreamingPlayback:worker-debug]', msg);
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
      if (totalFramesReceived <= 5) {
        diag(`frame recv #${totalFramesReceived} ts=${msg.timestamp?.toFixed(4)} hasBitmap=${msg.bitmap instanceof ImageBitmap} src=${msg.src?.slice(0, 40)}`);
      }

      if (msg.bitmap instanceof ImageBitmap) {
        state.buffer.push(msg.timestamp, msg.bitmap);
        state.undrawnCount++;
      }
      // NOTE: We do NOT send frame_consumed here.
      // Backpressure signals are sent in getFrame() when the render pipeline
      // actually draws a frame. This prevents the worker from racing ahead
      // indefinitely while the main thread is busy.
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
      return;
    }

    if (msg.type === 'error') {
      log.warn('Streaming decode error', { src: msg.src, message: msg.message });
      const state = streams.get(msg.src);
      if (state) {
        state.autoStartPending = false;
      }
      return;
    }
  }

  function getOrCreateState(src: string): StreamState {
    const existing = streams.get(src);
    if (existing) return existing;
    const state: StreamState = {
      buffer: new FrameBuffer(MAX_BUFFER_SIZE),
      info: null,
      streaming: false,
      undrawnCount: 0,
      lastAccessMs: performance.now(),
      autoStartPending: false,
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

  // Dev diagnostics — stash breadcrumbs on window for inspection
  const diagLog: string[] = [];
  if (import.meta.env.DEV) {
    (self as unknown as Record<string, unknown>).__STREAM_LOG__ = diagLog;
  }
  function diag(msg: string): void {
    diagLog.push(`${Date.now()}: ${msg}`);
    if (diagLog.length > 100) diagLog.shift();
  }

  function postStartMessage(src: string, startTimestamp: number, mediaId?: string): void {
    // Resolve the active blob URL via blobUrlManager when the passed src might be stale.
    // During re-renders (e.g. forceFastScrubOverlay flip), blob URLs get revoked and
    // recreated. The mediaId lets us find the current active URL and its blob.
    let activeSrc = src;
    if (mediaId) {
      const currentUrl = blobUrlManager.get(mediaId);
      if (currentUrl && currentUrl !== src) {
        diag(`resolved stale URL via mediaId=${mediaId}: ${src.slice(0, 30)} → ${currentUrl.slice(0, 30)}`);
        activeSrc = currentUrl;
      }
    }

    diag(`postStartMessage src=${activeSrc.slice(0, 50)} ts=${startTimestamp} workerReady=${workerReady}`);
    const sourceMetadata = getObjectUrlDirectFileMetadata(activeSrc) ?? undefined;
    const keyframeTimestamps = getKeyframeTimestamps(activeSrc) ?? getKeyframeTimestamps(src);
    const w = ensureWorker();

    const doPost = (blob?: Blob) => {
      diag(`doPost hasBlob=${!!blob} hasMetadata=${!!sourceMetadata} workerReady=${workerReady}`);
      const msg = {
        type: 'stream_start' as const,
        src: activeSrc,
        startTimestamp,
        blob,
        sourceMetadata,
        keyframeTimestamps,
      };
      if (workerReady) {
        w.postMessage(msg);
      } else {
        pendingStarts.push(() => w.postMessage(msg));
      }
    };

    if (sourceMetadata) {
      doPost();
    } else {
      const knownBlob = resolveBlobForWorker(activeSrc);
      if (knownBlob) {
        doPost(knownBlob);
      } else if (activeSrc.startsWith('blob:')) {
        diag(`fetching blob for ${activeSrc.slice(0, 40)}`);
        fetch(activeSrc).then((res) => res.blob()).then((blob) => {
          diag(`blob fetched size=${blob.size}`);
          blobByUrl.set(activeSrc, blob);
          doPost(blob);
        }).catch((err) => {
          diag(`blob fetch FAILED: ${err}`);
        });
      } else {
        doPost();
      }
    }
  }

  /** Send backpressure acknowledgments for drawn frames. */
  function ackDrawnFrames(src: string, count: number): void {
    if (!worker || count <= 0) return;
    for (let i = 0; i < count; i++) {
      worker.postMessage({ type: 'frame_consumed', src });
    }
  }

  /** Stop and clean up a single source. */
  function stopSource(src: string): void {
    const state = streams.get(src);
    if (!state) return;
    if (state.streaming) {
      worker?.postMessage({ type: 'stream_stop', src });
    }
    state.streaming = false;
    state.autoStartPending = false;
    state.buffer.clear();
    state.undrawnCount = 0;
  }

  /** Run idle cleanup: stop sources not accessed recently. */
  function idleSweep(): void {
    const now = performance.now();
    const toStop: string[] = [];
    for (const [src, state] of streams) {
      if (state.streaming && now - state.lastAccessMs > IDLE_TIMEOUT_MS) {
        toStop.push(src);
      }
    }
    for (const src of toStop) {
      log.debug('Stopping idle stream', { src: src.slice(0, 30) });
      stopSource(src);
      streams.delete(src);
    }
  }

  function startIdleSweep(): void {
    if (idleSweepTimer !== null) return;
    idleSweepTimer = setInterval(idleSweep, IDLE_SWEEP_INTERVAL_MS);
  }

  function stopIdleSweep(): void {
    if (idleSweepTimer !== null) {
      clearInterval(idleSweepTimer);
      idleSweepTimer = null;
    }
  }

  return {
    startStream(src: string, startTimestamp: number): void {
      if (disposed) return;
      const state = getOrCreateState(src);
      state.buffer.clear();
      state.streaming = true;
      state.undrawnCount = 0;
      state.lastAccessMs = performance.now();
      state.autoStartPending = false;

      postStartMessage(src, startTimestamp);
      startIdleSweep();
    },

    seekStream(src: string, timestamp: number): void {
      if (disposed) return;
      const state = streams.get(src);
      if (!state) return;

      state.buffer.clear();
      state.streaming = true;
      state.undrawnCount = 0;
      state.lastAccessMs = performance.now();

      worker?.postMessage({ type: 'stream_seek', src, timestamp });
    },

    stopStream(src: string): void {
      stopSource(src);
    },

    stopAll(): void {
      for (const [src] of streams) {
        stopSource(src);
      }
      streams.clear();
      stopIdleSweep();
    },

    getFrame(src: string, targetTimestamp: number, mediaId?: string): ImageBitmap | null {
      if (disposed) return null;

      let state = streams.get(src);

      // Lazy auto-start: first time we see a source, start streaming
      if (!state || (!state.streaming && !state.autoStartPending)) {
        // Resolve the active URL via mediaId. The renderer may pass a stale
        // blob URL from a previous render cycle. We need to key the stream
        // state by the active URL so worker frame messages match.
        let activeSrc = src;
        if (mediaId) {
          const currentUrl = blobUrlManager.get(mediaId);
          if (currentUrl) activeSrc = currentUrl;
        }
        diag(`getFrame auto-start src=${activeSrc.slice(0, 50)} mediaId=${mediaId} ts=${targetTimestamp.toFixed(3)}`);
        state = getOrCreateState(activeSrc);
        // Also register the original src so future lookups with either URL find the state
        if (activeSrc !== src) streams.set(src, state);
        state.autoStartPending = true;
        state.lastAccessMs = performance.now();
        state.streaming = true;
        state.autoStartPending = false;
        postStartMessage(activeSrc, targetTimestamp, mediaId);
        startIdleSweep();

        totalFramesMissed++;
        return null;
      }

      state.lastAccessMs = performance.now();

      const frame = state.buffer.getFrame(targetTimestamp);
      if (!frame) {
        if (totalFramesMissed < 5 || totalFramesMissed % 30 === 0) {
          diag(`getFrame MISS ts=${targetTimestamp.toFixed(4)} bufSize=${state.buffer.size} undrawn=${state.undrawnCount}`);
        }
        totalFramesMissed++;
        return null;
      }
      if (totalFramesDrawn < 3) {
        diag(`getFrame HIT ts=${targetTimestamp.toFixed(4)} frameTs=${frame.timestamp.toFixed(4)}`);
      }

      totalFramesDrawn++;

      // Prune old frames and send backpressure acks for consumed frames
      const pruned = state.buffer.pruneOld(targetTimestamp);
      const toAck = Math.min(state.undrawnCount, pruned + 1);
      state.undrawnCount = Math.max(0, state.undrawnCount - toAck);
      ackDrawnFrames(src, toAck);

      return frame.bitmap;
    },

    getSourceInfo(src: string): SourceInfo | null {
      return streams.get(src)?.info ?? null;
    },

    isStreaming(src: string): boolean {
      return streams.get(src)?.streaming ?? false;
    },

    dispose(): void {
      disposed = true;
      stopIdleSweep();
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
