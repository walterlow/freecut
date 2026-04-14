/**
 * Streaming video decode worker for WebCodecs-based playback.
 *
 * Runs mediabunny's forward `samples()` generator continuously, decoding
 * frames ahead of playback and transferring ImageBitmaps to the main thread.
 * This replaces the HTML5 <video> element playback path with frame-perfect,
 * worker-decoded frames that feed directly into the canvas/GPU render pipeline.
 *
 * Key difference from decoder-prewarm-worker: this worker runs a continuous
 * forward decode stream (not individual frame requests), maintaining decode
 * pipeline state across frames for ~1ms/frame sequential throughput.
 */

import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source';
import type { ObjectUrlSourceMetadata } from '@/infrastructure/browser/object-url-registry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max frames to buffer ahead before pausing decode. */
const MAX_BUFFER_AHEAD = 15;
/** Resume decode when buffer drops to this count. */
const RESUME_THRESHOLD = 8;
/** Epsilon for timestamp comparison. */
const TIMESTAMP_EPSILON = 1e-4;
/** Fixed backtrack from target when no keyframe index is available. */
const STREAM_BACKTRACK_SECONDS = 1.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MBSample = any;

interface SourceState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sink: any;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  duration: number;
  /** Whether a forward stream loop is currently running. */
  streaming: boolean;
  /** Incremented on every seek/stop to abort stale stream loops. */
  generation: number;
  /** Timestamps of frames currently buffered on the main thread (unacknowledged). */
  inflightCount: number;
  /** Whether decode is paused due to buffer pressure. */
  paused: boolean;
  /** Resolve function to wake up a paused decode loop. */
  resumeResolve: (() => void) | null;
}

/** Per-source keyframe index received from main thread. */
const keyframeIndexBySrc = new Map<string, number[]>();

// ---------------------------------------------------------------------------
// Mediabunny lazy load
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mb: any = null;
async function getMediabunny() {
  if (!mb) mb = await import('mediabunny');
  return mb;
}

// ---------------------------------------------------------------------------
// Source management
// ---------------------------------------------------------------------------

const sources = new Map<string, SourceState>();
const initPromises = new Map<string, Promise<SourceState | null>>();

function nearestKeyframeBefore(timestamps: number[], target: number): number | null {
  if (timestamps.length === 0 || timestamps[0]! > target) return null;
  let lo = 0;
  let hi = timestamps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (timestamps[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  return timestamps[lo]!;
}

function getStreamStart(src: string, targetTimestamp: number): number {
  const timestamps = keyframeIndexBySrc.get(src);
  if (timestamps && timestamps.length > 0) {
    const kf = nearestKeyframeBefore(timestamps, targetTimestamp);
    if (kf !== null) return Math.max(0, kf - 0.05);
  }
  return Math.max(0, targetTimestamp - STREAM_BACKTRACK_SECONDS);
}

interface InitSourceOptions {
  blob?: Blob;
  sourceMetadata?: ObjectUrlSourceMetadata;
}

async function getOrInitSource(src: string, options?: InitSourceOptions): Promise<SourceState | null> {
  const existing = sources.get(src);
  if (existing) return existing;

  const inflight = initPromises.get(src);
  if (inflight) return inflight;

  const promise = (async (): Promise<SourceState | null> => {
    const mediabunny = await getMediabunny();
    const source = createMediabunnyInputSource(mediabunny, src, {
      metadata: options?.sourceMetadata,
      fallbackBlob: options?.blob,
    });
    const input = new mediabunny.Input({
      formats: mediabunny.ALL_FORMATS,
      source,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        input.dispose?.();
        return null;
      }

      if (typeof videoTrack.canDecode === 'function' && !(await videoTrack.canDecode())) {
        input.dispose?.();
        return null;
      }

      // Extract keyframe index if not already available
      if (!keyframeIndexBySrc.has(src)) {
        try {
          const eps = new mediabunny.EncodedPacketSink(videoTrack);
          const kfTimestamps: number[] = [];
          const metadataOpts = { metadataOnly: true } as const;
          let pkt = await eps.getFirstKeyPacket(metadataOpts);
          while (pkt) {
            kfTimestamps.push(pkt.timestamp);
            pkt = await eps.getNextKeyPacket(pkt, metadataOpts);
          }
          eps.dispose?.();
          if (kfTimestamps.length > 0) {
            keyframeIndexBySrc.set(src, kfTimestamps);
            self.postMessage({ type: 'keyframes_extracted', src, keyframeTimestamps: kfTimestamps });
          }
        } catch {
          // Non-fatal
        }
      }

      const sink = new mediabunny.VideoSampleSink(videoTrack);
      const width = videoTrack.displayWidth || 1920;
      const height = videoTrack.displayHeight || 1080;
      const duration = videoTrack.duration || 0;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        input.dispose?.();
        return null;
      }

      const state: SourceState = {
        input,
        sink,
        canvas,
        ctx,
        width,
        height,
        duration,
        streaming: false,
        generation: 0,
        inflightCount: 0,
        paused: false,
        resumeResolve: null,
      };
      sources.set(src, state);

      self.postMessage({
        type: 'source_ready',
        src,
        width,
        height,
        duration,
      });

      return state;
    } catch (error) {
      input.dispose?.();
      throw error;
    }
  })();

  initPromises.set(src, promise);
  try {
    return await promise;
  } finally {
    initPromises.delete(src);
  }
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

function renderSampleToBitmap(state: SourceState, sample: MBSample): ImageBitmap | null {
  let videoFrame: VideoFrame | null = null;
  try {
    videoFrame = typeof sample.toVideoFrame === 'function'
      ? sample.toVideoFrame()
      : (sample.frame ?? null);
    if (!videoFrame) return null;

    const visibleRect = (videoFrame as VideoFrame & {
      visibleRect?: { x: number; y: number; width: number; height: number };
    }).visibleRect;

    const width = visibleRect?.width && visibleRect.width > 0
      ? visibleRect.width : videoFrame.displayWidth;
    const height = visibleRect?.height && visibleRect.height > 0
      ? visibleRect.height : videoFrame.displayHeight;
    if (width < 1 || height < 1) return null;

    // Resize canvas if dimensions changed
    if (state.canvas.width !== width || state.canvas.height !== height) {
      state.canvas.width = width;
      state.canvas.height = height;
    }

    if (visibleRect && visibleRect.width > 0 && visibleRect.height > 0) {
      state.ctx.drawImage(
        videoFrame,
        visibleRect.x, visibleRect.y, visibleRect.width, visibleRect.height,
        0, 0, width, height,
      );
    } else {
      state.ctx.drawImage(videoFrame, 0, 0, width, height);
    }

    return state.canvas.transferToImageBitmap();
  } finally {
    videoFrame?.close();
  }
}

// ---------------------------------------------------------------------------
// Streaming decode loop
// ---------------------------------------------------------------------------

async function runStreamLoop(src: string, state: SourceState, startTimestamp: number): Promise<void> {
  const gen = state.generation;
  state.streaming = true;
  state.inflightCount = 0;
  state.paused = false;

  const streamStart = getStreamStart(src, startTimestamp);
  self.postMessage({ type: 'debug', step: 'stream_loop_starting', src: src.slice(0, 50), streamStart, startTimestamp });
  const iterator = state.sink.samples(streamStart, Infinity) as AsyncGenerator<MBSample, void, unknown>;
  let frameCount = 0;

  try {
    for await (const sample of iterator) {
      // Abort if generation changed (seek or stop happened)
      if (state.generation !== gen) {
        sample.close?.();
        break;
      }

      const timestamp: number = sample.timestamp ?? 0;

      // Skip samples before our target (we started from a keyframe before target)
      if (timestamp + TIMESTAMP_EPSILON < startTimestamp) {
        sample.close?.();
        continue;
      }

      // Render to bitmap
      const bitmap = renderSampleToBitmap(state, sample);
      sample.close?.();

      if (!bitmap) continue;
      if (state.generation !== gen) {
        bitmap.close();
        break;
      }

      // Post frame to main thread (bitmap is in data AND transfer list for zero-copy)
      state.inflightCount++;
      frameCount++;
      if (frameCount <= 3) {
        self.postMessage({ type: 'debug', step: 'posting_frame', frameCount, timestamp, bitmapWidth: bitmap.width, bitmapHeight: bitmap.height });
      }
      self.postMessage(
        {
          type: 'frame',
          src,
          timestamp,
          bitmap,
        },
        { transfer: [bitmap] },
      );

      // Backpressure: pause if too many frames unacknowledged
      if (state.inflightCount >= MAX_BUFFER_AHEAD) {
        state.paused = true;
        await new Promise<void>((resolve) => {
          state.resumeResolve = resolve;
          // Safety: auto-resume after 500ms to prevent deadlock
          setTimeout(() => {
            if (state.resumeResolve === resolve) {
              state.paused = false;
              state.resumeResolve = null;
              resolve();
            }
          }, 500);
        });
        // Check generation after waking up
        if (state.generation !== gen) break;
      }
    }
  } catch (error) {
    if (state.generation === gen) {
      self.postMessage({
        type: 'error',
        src,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    void iterator.return?.();
    if (state.generation === gen) {
      state.streaming = false;
      self.postMessage({ type: 'stream_ended', src });
    }
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.postMessage({ type: 'ready' });

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'warmup') {
    void getMediabunny();
    return;
  }

  if (msg.type === 'set_keyframes') {
    if (msg.src && Array.isArray(msg.keyframeTimestamps)) {
      keyframeIndexBySrc.set(msg.src, msg.keyframeTimestamps);
    }
    return;
  }

  if (msg.type === 'stream_start') {
    const { src, startTimestamp, blob, sourceMetadata } = msg;
    self.postMessage({ type: 'debug', step: 'stream_start_received', src: src?.slice(0, 50), hasBlob: !!blob, hasMetadata: !!sourceMetadata, startTimestamp });
    try {
      const state = await getOrInitSource(src, { blob, sourceMetadata });
      if (!state) {
        self.postMessage({ type: 'error', src, message: 'Failed to init source — getOrInitSource returned null' });
        return;
      }
      self.postMessage({ type: 'debug', step: 'source_initialized', src: src?.slice(0, 50), width: state.width, height: state.height });
      // Bump generation to abort any existing stream loop
      state.generation++;
      if (state.resumeResolve) {
        state.resumeResolve();
        state.resumeResolve = null;
      }
      // Start new stream
      void runStreamLoop(src, state, startTimestamp);
    } catch (error) {
      self.postMessage({
        type: 'error',
        src,
        message: `stream_start failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return;
  }

  if (msg.type === 'stream_seek') {
    const { src, timestamp } = msg;
    const state = sources.get(src);
    if (!state) return;
    // Bump generation to abort current loop, start new one
    state.generation++;
    if (state.resumeResolve) {
      state.resumeResolve();
      state.resumeResolve = null;
    }
    void runStreamLoop(src, state, timestamp);
    return;
  }

  if (msg.type === 'stream_stop') {
    const { src } = msg;
    const state = sources.get(src);
    if (!state) return;
    state.generation++;
    if (state.resumeResolve) {
      state.resumeResolve();
      state.resumeResolve = null;
    }
    return;
  }

  if (msg.type === 'frame_consumed') {
    const { src } = msg;
    const state = sources.get(src);
    if (!state) return;
    state.inflightCount = Math.max(0, state.inflightCount - 1);
    // Resume decode if we dropped below threshold
    if (state.paused && state.inflightCount <= RESUME_THRESHOLD && state.resumeResolve) {
      state.paused = false;
      const resolve = state.resumeResolve;
      state.resumeResolve = null;
      resolve();
    }
    return;
  }

  if (msg.type === 'dispose_source') {
    const { src } = msg;
    const state = sources.get(src);
    if (!state) return;
    state.generation++;
    if (state.resumeResolve) {
      state.resumeResolve();
      state.resumeResolve = null;
    }
    state.input.dispose?.();
    sources.delete(src);
    return;
  }
};
