/**
 * Main-thread audio streaming source for codecs that can't decode in Workers.
 *
 * For codecs like AC-3/E-AC-3, mediabunny's AudioBufferSink.buffers() hangs in
 * Web Workers despite canDecode() returning true.  This module runs the same
 * decode loop on the main thread and pushes chunks into the StreamingPlayback
 * audio buffer, where the existing audio scheduler picks them up.
 *
 * The decode loop is lightweight (audio-only, no video demux) and yields per-
 * chunk so the main thread stays responsive.
 */

import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source';
import { ensureAc3DecoderRegistered } from '@/shared/media/ac3-decoder';
import { createLogger } from '@/shared/logging/logger';
import type { StreamingAudioChunk } from './streaming-playback';

const log = createLogger('MainThreadAudio');

const MAX_DECODE_AHEAD_SECONDS = 2.5;
const THROTTLE_SLEEP_MS = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MainThreadAudioSourceDeps {
  pushAudioChunk: (streamKey: string, chunk: StreamingAudioChunk) => void;
  getStreamGeneration: (streamKey: string) => number;
}

export interface MainThreadAudioSource {
  warmup(): void;
  start(streamKey: string, src: string | Blob, startTimestamp: number): void;
  seek(streamKey: string, timestamp: number): void;
  stop(streamKey: string): void;
  stopAll(): void;
  updatePosition(streamKey: string, position: number): void;
  dispose(): void;
}

interface AudioStreamState {
  streamKey: string;
  src: string | Blob;
  generation: number;
  playbackPosition: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sink: any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initPromise: Promise<any | null> | null;
}

// ---------------------------------------------------------------------------
// Downmix (same coefficients as the worker and audio-decode-cache)
// ---------------------------------------------------------------------------

function downmixToStereoBuffer(buffer: AudioBuffer): AudioBuffer {
  const numCh = buffer.numberOfChannels;
  if (numCh <= 2) return buffer;

  const frames = buffer.length;
  const out = new AudioBuffer({
    numberOfChannels: 2,
    length: frames,
    sampleRate: buffer.sampleRate,
  });

  const centerGain = 0.7071;
  const surroundGain = 0.7071;

  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const C = numCh > 2 ? buffer.getChannelData(2) : null;
  const Ls = numCh > 4 ? buffer.getChannelData(4) : null;
  const Rs = numCh > 5 ? buffer.getChannelData(5) : null;

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    let l = L[i]!;
    let r = R[i]!;
    if (C) {
      const c = C[i]! * centerGain;
      l += c;
      r += c;
    }
    if (Ls) l += Ls[i]! * surroundGain;
    if (Rs) r += Rs[i]! * surroundGain;
    left[i] = l;
    right[i] = r;
  }

  out.copyToChannel(left, 0);
  out.copyToChannel(right, 1);
  return out;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export function createMainThreadAudioSource(
  deps: MainThreadAudioSourceDeps,
): MainThreadAudioSource {
  const streams = new Map<string, AudioStreamState>();
  let disposed = false;
  let warmupPromise: Promise<void> | null = null;

  function warmupDecoder(): Promise<void> {
    if (!warmupPromise) {
      warmupPromise = (async () => {
        await ensureAc3DecoderRegistered();
        await import('mediabunny');
      })();
    }
    return warmupPromise;
  }

  function getOrCreate(streamKey: string, src: string | Blob): AudioStreamState {
    const existing = streams.get(streamKey);
    if (existing) return existing;
    const state: AudioStreamState = {
      streamKey,
      src,
      generation: 0,
      playbackPosition: 0,
      input: null,
      sink: null,
      initPromise: null,
    };
    streams.set(streamKey, state);
    return state;
  }

  function resetResources(state: AudioStreamState): void {
    try {
      state.input?.dispose?.();
    } catch {
      // Best-effort cleanup only.
    }
    state.input = null;
    state.sink = null;
    state.initPromise = null;
  }

  async function getOrInitSink(state: AudioStreamState) {
    if (state.sink) {
      return state.sink;
    }
    if (state.initPromise) {
      return state.initPromise;
    }

    state.initPromise = (async () => {
      await warmupDecoder();
      if (disposed) return null;
      const mb = await import('mediabunny');
      if (disposed) return null;

      const input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: createMediabunnyInputSource(mb, state.src),
      });

      try {
        const audioTrack = await input.getPrimaryAudioTrack();
        if (!audioTrack || disposed) {
          input.dispose?.();
          return null;
        }

        const sink = new mb.AudioBufferSink(audioTrack);
        state.input = input;
        state.sink = sink;
        return sink;
      } catch (error) {
        input.dispose?.();
        throw error;
      } finally {
        state.initPromise = null;
      }
    })();

    return state.initPromise;
  }

  async function runDecodeLoop(
    state: AudioStreamState,
    startTimestamp: number,
    gen: number,
  ): Promise<void> {
    const sink = await getOrInitSink(state);
    if (!sink || state.generation !== gen || disposed) return;

    try {
      for await (const wrappedBuffer of sink.buffers(startTimestamp, Infinity)) {
        if (state.generation !== gen || disposed) break;

        const timestamp: number = wrappedBuffer.timestamp ?? 0;
        const duration: number = wrappedBuffer.duration ?? wrappedBuffer.buffer.duration ?? 0;
        const audioBuffer: AudioBuffer = wrappedBuffer.buffer;
        if (audioBuffer.length <= 0) continue;

        const stereo = audioBuffer.numberOfChannels > 2
          ? downmixToStereoBuffer(audioBuffer)
          : audioBuffer;

        deps.pushAudioChunk(state.streamKey, {
          timestamp,
          duration,
          buffer: stereo,
        });

        // Throttle: don't decode too far ahead of playback
        while (
          state.generation === gen
          && !disposed
          && (timestamp + duration) > state.playbackPosition + MAX_DECODE_AHEAD_SECONDS
        ) {
          await new Promise<void>((r) => setTimeout(r, THROTTLE_SLEEP_MS));
        }
      }
    } catch (error) {
      if (state.generation === gen && !disposed) {
        log.warn('Main-thread audio decode failed', {
          streamKey: state.streamKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    warmup(): void {
      void warmupDecoder();
    },

    start(streamKey: string, src: string | Blob, startTimestamp: number): void {
      if (disposed) return;
      const state = getOrCreate(streamKey, src);
      if (state.src !== src) {
        resetResources(state);
      }
      state.src = src;
      state.generation++;
      state.playbackPosition = startTimestamp;
      const gen = state.generation;
      void runDecodeLoop(state, startTimestamp, gen);
    },

    seek(streamKey: string, timestamp: number): void {
      const state = streams.get(streamKey);
      if (!state || disposed) return;
      state.generation++;
      state.playbackPosition = timestamp;
      const gen = state.generation;
      void runDecodeLoop(state, timestamp, gen);
    },

    stop(streamKey: string): void {
      const state = streams.get(streamKey);
      if (state) {
        state.generation++;
        resetResources(state);
        streams.delete(streamKey);
      }
    },

    stopAll(): void {
      for (const state of streams.values()) {
        state.generation++;
        resetResources(state);
      }
      streams.clear();
    },

    updatePosition(streamKey: string, position: number): void {
      const state = streams.get(streamKey);
      if (state) state.playbackPosition = position;
    },

    dispose(): void {
      disposed = true;
      for (const state of streams.values()) {
        state.generation++;
        resetResources(state);
      }
      streams.clear();
    },
  };
}
