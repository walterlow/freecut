/**
 * Main-thread coordinator for WebCodecs streaming playback.
 *
 * Manages streaming decode workers and provides decoded ImageBitmaps
 * to the render pipeline as a drop-in replacement for DOM video elements.
 *
 * Key behaviors:
 * - Lazy auto-start: getFrame() for an unknown source triggers async stream init
 * - Position-aware throttle: worker stays within 1.5s ahead of playback position
 * - Idle cleanup: sources not requested for IDLE_TIMEOUT_MS are stopped
 *
 * Usage:
 *   const playback = createStreamingPlayback();
 *   playback.startStream('clip-123', 'blob:...', 0.5);
 *   const frame = playback.getFrame('clip-123', 'blob:...', 1.2);
 *   playback.stopAll();
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
// Constants
// ---------------------------------------------------------------------------

/** How long a source can go without getFrame() calls before being stopped. */
const IDLE_TIMEOUT_MS = 3000;
/** How often to run the idle cleanup sweep. */
const IDLE_SWEEP_INTERVAL_MS = 1000;
/** Maximum frames buffered per source. Must be larger than
 *  MAX_DECODE_AHEAD_SECONDS * max_fps to avoid evicting frames the
 *  worker just decoded. 90 frames covers 3s@30fps or 1.5s@60fps. */
const MAX_BUFFER_SIZE = 90;
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

    // Reject stale frames — return null so the renderer falls through to
    // DOM video instead of showing a frozen frame from seconds ago.
    return null;
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
  src: string;
  buffer: FrameBuffer;
  info: SourceInfo | null;
  streaming: boolean;
  /** Timestamp (ms) of the last getFrame() call. Used for idle cleanup. */
  lastAccessMs: number;
  /** Monotonic counter bumped on every start/stop — used to detect stale
   *  async callbacks (e.g. blob fetch) that resolve after the stream was
   *  stopped or restarted. */
  generation: number;
}

// ---------------------------------------------------------------------------
// Streaming playback coordinator
// ---------------------------------------------------------------------------

export interface StreamingPlayback {
  /** Start streaming decode for a playback instance from a given timestamp. */
  startStream(streamKey: string, src: string, startTimestamp: number): void;
  /** Seek an active stream to a new timestamp. */
  seekStream(streamKey: string, timestamp: number): void;
  /** Stop streaming for a source. */
  stopStream(streamKey: string): void;
  /** Stop all active streams. */
  stopAll(): void;
  /**
   * Get the best decoded frame for a playback instance at a target timestamp.
   * If no stream exists for this instance, lazily starts one and returns null.
   * Falls through to the next render path (DOM video) until frames arrive.
   */
  getFrame(streamKey: string, src: string, targetTimestamp: number): ImageBitmap | null;
  /** Get source info (dimensions, duration) if available. */
  getSourceInfo(streamKey: string): SourceInfo | null;
  /** Whether a source is actively streaming. */
  isStreaming(streamKey: string): boolean;
  /** Update the worker's playback position for a source without reading a frame.
   *  Keeps the decode-ahead throttle advancing during DOM video playback
   *  so the buffer is warm when the canvas overlay activates. */
  updatePosition(streamKey: string, position: number): void;
  /** Enable idle cleanup sweep. Call when playback starts.
   *  Disabled by default so pre-warm streams aren't killed while paused. */
  enableIdleSweep(): void;
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

  function ensureWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
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
      for (const fn of pendingStarts) fn();
      pendingStarts.length = 0;
      return;
    }

    if (msg.type === 'source_ready') {
      const state = streams.get(msg.streamKey);
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
      const state = streams.get(msg.streamKey);
      if (!state) {
        // No stream for this source — close the frame to avoid leak
        if (msg.videoFrame instanceof VideoFrame) msg.videoFrame.close();
        return;
      }

      totalFramesReceived++;

      // Worker sends VideoFrame (zero-copy transfer). Convert to ImageBitmap
      // on the main thread so the VideoFrame can be closed immediately.
      // createImageBitmap(VideoFrame) is ~0.3ms — much faster than the worker
      // doing drawImage + transferToImageBitmap (~2-5ms).
      const videoFrame: VideoFrame | null = msg.videoFrame instanceof VideoFrame ? msg.videoFrame : null;
      if (videoFrame) {
        createImageBitmap(videoFrame).then((bitmap) => {
          videoFrame.close();
          // Guard: state may have been removed from `streams` by stopAll()
          // while this createImageBitmap was in-flight.
          if (streams.has(msg.streamKey)) {
            state.buffer.push(msg.timestamp, bitmap);
          } else {
            bitmap.close();
          }
        }).catch(() => {
          videoFrame.close();
        });
        return;
      }

      // Fallback: ImageBitmap from older worker version
      if (msg.bitmap instanceof ImageBitmap) {
        state.buffer.push(msg.timestamp, msg.bitmap);
      }
      return;
    }

    if (msg.type === 'stream_ended') {
      const state = streams.get(msg.streamKey);
      if (state) {
        state.streaming = false;
      }
      return;
    }

    if (msg.type === 'keyframes_extracted') {
      return;
    }

    if (msg.type === 'error') {
      log.warn('Streaming decode error', { streamKey: msg.streamKey, src: msg.src, message: msg.message });
      return;
    }
  }

  function getOrCreateState(streamKey: string, src: string): StreamState {
    const existing = streams.get(streamKey);
    if (existing) return existing;
    const state: StreamState = {
      src,
      buffer: new FrameBuffer(MAX_BUFFER_SIZE),
      info: null,
      streaming: false,
      lastAccessMs: performance.now(),
      generation: 0,
    };
    streams.set(streamKey, state);
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

  function postStartMessage(streamKey: string, src: string, startTimestamp: number): void {
    // The caller is responsible for resolving the correct URL (proxy or original).
    // We no longer override via blobUrlManager here — that would replace proxy URLs
    // with original URLs, defeating the proxy resolution in collectPrewarmTargets.
    const activeSrc = src;

    const sourceMetadata = getObjectUrlDirectFileMetadata(activeSrc) ?? undefined;
    const keyframeTimestamps = getKeyframeTimestamps(activeSrc);
    const w = ensureWorker();
    if (!w) return;

    const doPost = (blob?: Blob) => {
      const msg = {
        type: 'stream_start' as const,
        streamKey,
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
        // Capture generation so we can detect stop/restart during the async fetch.
        const gen = streams.get(streamKey)?.generation ?? -1;
        fetch(activeSrc).then((res) => res.blob()).then((blob) => {
          const current = streams.get(streamKey);
          if (!current || current.generation !== gen) return;
          blobByUrl.set(activeSrc, blob);
          doPost(blob);
        }).catch(() => {
          // Blob URL may have been revoked — source can't be decoded
        });
      } else {
        doPost();
      }
    }
  }

  /** Stop and clean up a single source. */
  function stopSource(streamKey: string): void {
    const state = streams.get(streamKey);
    if (!state) return;
    state.generation++;
    if (state.streaming) {
      worker?.postMessage({ type: 'stream_stop', streamKey });
    }
    state.streaming = false;
    state.buffer.clear();
  }

  /** Run idle cleanup: stop sources not accessed recently. */
  function idleSweep(): void {
    const now = performance.now();
    const toStop: string[] = [];
    for (const [streamKey, state] of streams) {
      if (state.streaming && now - state.lastAccessMs > IDLE_TIMEOUT_MS) {
        toStop.push(streamKey);
      }
    }
    for (const streamKey of toStop) {
      const src = streams.get(streamKey)?.src;
      log.debug('Stopping idle stream', { streamKey, src: src?.slice(0, 30) });
      stopSource(streamKey);
      worker?.postMessage({ type: 'dispose_source', streamKey });
      streams.delete(streamKey);
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
    startStream(streamKey: string, src: string, startTimestamp: number): void {
      if (disposed) return;
      const state = getOrCreateState(streamKey, src);
      state.generation++;
      state.src = src;
      state.buffer.clear();
      state.streaming = true;
      state.lastAccessMs = performance.now();

      postStartMessage(streamKey, src, startTimestamp);
    },

    seekStream(streamKey: string, timestamp: number): void {
      if (disposed) return;
      const state = streams.get(streamKey);
      if (!state) return;

      state.buffer.clear();
      state.streaming = true;
      state.lastAccessMs = performance.now();

      const doSeek = () => worker?.postMessage({ type: 'stream_seek', streamKey, timestamp });
      if (workerReady) {
        doSeek();
      } else {
        pendingStarts.push(doSeek);
      }
    },

    stopStream(streamKey: string): void {
      stopSource(streamKey);
    },

    stopAll(): void {
      for (const [streamKey] of streams) {
        stopSource(streamKey);
        worker?.postMessage({ type: 'dispose_source', streamKey });
      }
      streams.clear();
      stopIdleSweep();
    },

    getFrame(streamKey: string, src: string, targetTimestamp: number): ImageBitmap | null {
      if (disposed) return null;

      let state = streams.get(streamKey) ?? null;

      if (!state || !state.streaming) {
        state = getOrCreateState(streamKey, src);
        state.generation++;
        state.src = src;
        state.lastAccessMs = performance.now();
        state.streaming = true;
        postStartMessage(streamKey, src, targetTimestamp);

        totalFramesMissed++;
        return null;
      }

      state.src = src;
      state.lastAccessMs = performance.now();
      worker?.postMessage({ type: 'playback_position', streamKey, position: targetTimestamp });

      const frame = state.buffer.getFrame(targetTimestamp);
      if (!frame) {
        totalFramesMissed++;
        return null;
      }

      totalFramesDrawn++;
      state.buffer.pruneOld(targetTimestamp);

      return frame.bitmap;
    },

    getSourceInfo(streamKey: string): SourceInfo | null {
      return streams.get(streamKey)?.info ?? null;
    },

    isStreaming(streamKey: string): boolean {
      return streams.get(streamKey)?.streaming ?? false;
    },

    updatePosition(streamKey: string, position: number): void {
      const state = streams.get(streamKey);
      if (!state) return;
      state.lastAccessMs = performance.now();
      worker?.postMessage({ type: 'playback_position', streamKey, position });
    },

    enableIdleSweep(): void {
      startIdleSweep();
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
      for (const [streamKey, state] of streams) {
        bufferSizes.set(streamKey, state.buffer.size);
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
