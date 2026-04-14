/**
 * Streaming video decode worker for WebCodecs-based playback.
 *
 * Runs mediabunny's forward `samples()` generator continuously, transferring
 * decoded VideoFrames directly to the main thread (zero intermediate copies).
 * The main thread ring buffer handles overflow — no backpressure needed.
 *
 * Decode throughput: ~1ms/frame for forward sequential access once warmed.
 * Initial keyframe seek: 200-600ms (one-time cost per stream start).
 */

import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source';
import type { ObjectUrlSourceMetadata } from '@/infrastructure/browser/object-url-registry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMESTAMP_EPSILON = 1e-4;
const STREAM_BACKTRACK_SECONDS = 1.0;
/** Max seconds the worker may decode ahead of the last known playback position.
 *  Matches the main thread's ring buffer capacity (90 frames / 30fps = 3s)
 *  so the full transition window can be pre-buffered. */
const MAX_DECODE_AHEAD_SECONDS = 2.5;
/** How long to sleep when throttled before checking again. */
const THROTTLE_SLEEP_MS = 50;

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
  width: number;
  height: number;
  duration: number;
  streaming: boolean;
  /** Incremented on every seek/stop to abort stale stream loops. */
  generation: number;
  /** Last known playback position (seconds). Updated by main thread.
   *  Worker throttles decode to stay within MAX_DECODE_AHEAD_SECONDS of this. */
  playbackPosition: number;
}

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

      const state: SourceState = {
        input,
        sink,
        width,
        height,
        duration,
        streaming: false,
        generation: 0,
        playbackPosition: 0,
      };
      sources.set(src, state);

      self.postMessage({ type: 'source_ready', src, width, height, duration });
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
// Frame extraction — transfer VideoFrame directly (zero copy)
// ---------------------------------------------------------------------------

/**
 * Extract a VideoFrame from a mediabunny sample and compute its visible dimensions.
 * Returns null if the sample can't produce a valid frame.
 * Caller must close the returned VideoFrame when done.
 */
function extractVideoFrame(sample: MBSample): { frame: VideoFrame; width: number; height: number } | null {
  const videoFrame: VideoFrame | null = typeof sample.toVideoFrame === 'function'
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

  if (width < 1 || height < 1) {
    videoFrame.close();
    return null;
  }

  // If visibleRect is a strict subset (codec padding), create a cropped copy
  // so the main thread draws the correct region without needing to know the offset.
  if (
    visibleRect
    && (visibleRect.x > 0 || visibleRect.y > 0
      || visibleRect.width < videoFrame.codedWidth
      || visibleRect.height < videoFrame.codedHeight)
  ) {
    try {
      const cropped = new VideoFrame(videoFrame, {
        visibleRect: { x: visibleRect.x, y: visibleRect.y, width, height },
      });
      videoFrame.close();
      return { frame: cropped, width, height };
    } catch {
      // Cropping unsupported — fall through and send the full frame
    }
  }

  return { frame: videoFrame, width, height };
}

// ---------------------------------------------------------------------------
// Streaming decode loop
// ---------------------------------------------------------------------------

async function runStreamLoop(src: string, state: SourceState, startTimestamp: number): Promise<void> {
  const gen = state.generation;
  state.streaming = true;

  const streamStart = getStreamStart(src, startTimestamp);
  const iterator = state.sink.samples(streamStart, Infinity) as AsyncGenerator<MBSample, void, unknown>;

  try {
    for await (const sample of iterator) {
      if (state.generation !== gen) {
        sample.close?.();
        break;
      }

      const timestamp: number = sample.timestamp ?? 0;

      // Skip samples before our target (decode started from a keyframe before target)
      if (timestamp + TIMESTAMP_EPSILON < startTimestamp) {
        sample.close?.();
        continue;
      }

      // Extract VideoFrame directly (no intermediate canvas copy)
      const extracted = extractVideoFrame(sample);
      sample.close?.();

      if (!extracted) continue;
      if (state.generation !== gen) {
        extracted.frame.close();
        break;
      }

      // Transfer VideoFrame to main thread (zero-copy via transferable)
      self.postMessage(
        {
          type: 'frame',
          src,
          timestamp,
          videoFrame: extracted.frame,
          width: extracted.width,
          height: extracted.height,
        },
        { transfer: [extracted.frame] },
      );

      // Position-aware throttle: don't decode more than MAX_DECODE_AHEAD_SECONDS
      // ahead of where playback currently is. Without this, the worker races
      // far ahead during pre-warm, overflowing the main thread's ring buffer
      // and causing the renderer to show frames from the distant future.
      while (
        state.generation === gen
        && timestamp > state.playbackPosition + MAX_DECODE_AHEAD_SECONDS
      ) {
        await new Promise<void>((r) => setTimeout(r, THROTTLE_SLEEP_MS));
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

  if (msg.type === 'playback_position') {
    const { src, position } = msg;
    const state = sources.get(src);
    if (state) state.playbackPosition = position;
    return;
  }

  if (msg.type === 'stream_start') {
    const { src, startTimestamp, blob, sourceMetadata } = msg;
    try {
      const state = await getOrInitSource(src, { blob, sourceMetadata });
      if (!state) {
        self.postMessage({ type: 'error', src, message: 'Failed to init source' });
        return;
      }
      state.generation++;
      state.playbackPosition = startTimestamp;
      void runStreamLoop(src, state, startTimestamp);
    } catch (error) {
      self.postMessage({
        type: 'error',
        src,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (msg.type === 'stream_seek') {
    const { src, timestamp } = msg;
    const state = sources.get(src);
    if (!state) return;
    state.generation++;
    state.playbackPosition = timestamp;
    void runStreamLoop(src, state, timestamp);
    return;
  }

  if (msg.type === 'stream_stop') {
    const { src } = msg;
    const state = sources.get(src);
    if (!state) return;
    state.generation++;
    return;
  }

  if (msg.type === 'dispose_source') {
    const { src } = msg;
    const state = sources.get(src);
    if (!state) return;
    state.generation++;
    state.input.dispose?.();
    sources.delete(src);
    return;
  }
};
