/**
 * Streaming decode session for ProRes preview playback.
 *
 * The browser can't play ProRes through a `<video>` element, so the preview canvas decodes
 * frames itself. mediabunny's `VideoSampleSink` (with the registered `@mediabunny/prores`
 * decoder) ties **one decoder to one `samples()` generator** and closes it when the
 * generator ends — so the way to keep a decoder warm across many frames is to hold a single
 * long-lived forward stream and pull from it, exactly like the export
 * `VideoFrameExtractor`. This session wraps that: a persistent `samples(start, ∞)` iterator
 * that advances forward frame-by-frame, restarting only on a backward seek or a large
 * forward jump.
 *
 * TRADEOFF: forward playback and paused seeks reuse one warm decoder (cheap). Backward
 * motion restarts the stream, which respawns the decoder's worker pool (~100ms) — so
 * backward scrubbing is laggy and *reverse playback* (a backward seek every tick) is slow.
 * There is no native way around this: `getSample` and per-frame `samplesAtTimestamps` also
 * spawn a decoder per call. This is the deliberate cost of decoding ProRes through
 * mediabunny's sinks instead of a bespoke decoder that owns a persistent worker pool.
 *
 * `getSampleForTime` returns a **borrowed** sample owned by the session — valid until the
 * next `getSampleForTime` (which may close it to advance) or `dispose`. Callers draw it
 * synchronously and must not close or retain it. Calls are serialized internally so the
 * shared stream cursor is never advanced concurrently.
 */

import type { Input, InputVideoTrack, VideoSample, VideoSampleSink } from 'mediabunny'
import { createLogger } from '@/shared/logging/logger'

type MediabunnyModule = typeof import('mediabunny')

const log = createLogger('ProResPreviewSession')

/** Presentation-time slop for matching a sample to a requested timestamp. */
const TIMESTAMP_EPSILON = 1e-4
/**
 * A first sample landing within this many seconds *after* the requested time (right after a
 * stream (re)start) is accepted as the current frame, absorbing timestamp quantization/drift
 * instead of reporting a false miss.
 */
const LOOKAHEAD_TOLERANCE_SECONDS = 0.05
/**
 * Forward jump beyond this restarts the stream at the new position instead of reading
 * through every intervening frame — cheaper than decoding hundreds of frames to catch up.
 */
const FORWARD_JUMP_RESTART_SECONDS = 3.0

export interface ProResPreviewSession {
  /**
   * Advance/seek to the frame covering `timeSeconds` and return it (borrowed — owned by the
   * session, valid until the next call or dispose). Returns null if no frame is available
   * (e.g. a timestamp before the first frame) or the session is disposed.
   */
  getSampleForTime(timeSeconds: number): Promise<VideoSample | null>
  /** Release the decoder, stream and input. Idempotent. */
  dispose(): Promise<void>
}

/**
 * Creates a preview session for an already-opened ProRes input. The session owns `input`
 * and disposes it on {@link ProResPreviewSession.dispose}.
 */
export function createProResPreviewSession(
  mb: MediabunnyModule,
  input: InstanceType<typeof Input>,
  videoTrack: InputVideoTrack,
): ProResPreviewSession {
  const sink: VideoSampleSink = new mb.VideoSampleSink(videoTrack)

  let disposed = false
  let iterator: AsyncGenerator<VideoSample, void, unknown> | null = null
  let iteratorDone = false
  let currentSample: VideoSample | null = null
  /** One sample read ahead of `currentSample` but not yet reached by the playhead. */
  let peekedSample: VideoSample | null = null
  let lastRequestedTime: number | null = null
  // Serializes access so overlapping ticks (clock + prop-change effect) never advance the
  // single stream cursor concurrently. Kept alive past errors so one bad decode doesn't
  // wedge the session.
  let chain: Promise<VideoSample | null> = Promise.resolve(null)

  const closeSample = (sample: VideoSample | null): void => {
    if (!sample) return
    try {
      sample.close()
    } catch {
      // Ignore close errors — the frame may already be released.
    }
  }

  const closeStream = (): void => {
    if (iterator) {
      void iterator.return?.()
    }
    iterator = null
    iteratorDone = true
    closeSample(peekedSample)
    peekedSample = null
  }

  const resetIterator = (startTime: number): void => {
    closeStream()
    // Drop the sample from the previous cursor so the fresh stream starts with no carried-over
    // frame — otherwise advanceTo would keep returning (or skip lookahead acceptance of) a stale
    // sample that belongs to the old iterator position.
    closeSample(currentSample)
    currentSample = null
    // ProRes is all-intra, so every frame is a keyframe: starting the stream exactly at the
    // requested time yields the covering frame first with no backtracking.
    iterator = sink.samples(Math.max(0, startTime), Infinity)
    iteratorDone = false
    lastRequestedTime = null
  }

  const peekNext = async (): Promise<VideoSample | null> => {
    if (peekedSample) return peekedSample
    if (!iterator || iteratorDone) return null
    const result = await iterator.next()
    if (result.done) {
      iteratorDone = true
      return null
    }
    peekedSample = result.value
    return peekedSample
  }

  const currentCoversTime = (time: number): boolean => {
    const sample = currentSample
    if (!sample) return false
    if (sample.timestamp > time + TIMESTAMP_EPSILON) return false
    if (typeof sample.duration !== 'number' || !Number.isFinite(sample.duration) || sample.duration <= 0) {
      return true
    }
    return sample.timestamp + sample.duration >= time - TIMESTAMP_EPSILON
  }

  const advanceTo = async (time: number): Promise<VideoSample | null> => {
    while (true) {
      const candidate = await peekNext()
      if (!candidate) break
      if (candidate.timestamp <= time + TIMESTAMP_EPSILON) {
        // Playhead has reached the next frame — promote it, closing the one it replaces.
        closeSample(currentSample)
        currentSample = candidate
        peekedSample = null
        continue
      }
      // First frame after a (re)start that's only just ahead of the request: accept it so a
      // paused seek doesn't miss on quantization drift.
      if (!currentSample && candidate.timestamp - time <= LOOKAHEAD_TOLERANCE_SECONDS) {
        currentSample = candidate
        peekedSample = null
      }
      break
    }
    return currentSample
  }

  const runGetSample = async (time: number): Promise<VideoSample | null> => {
    if (disposed) return null
    const target = Math.max(0, time)

    if (!iterator) {
      resetIterator(target)
    } else if (
      lastRequestedTime !== null &&
      target + TIMESTAMP_EPSILON < lastRequestedTime &&
      !currentCoversTime(target)
    ) {
      // Backward seek past the current frame — restart the forward stream at the new time.
      resetIterator(target)
    } else if (lastRequestedTime !== null && target - lastRequestedTime > FORWARD_JUMP_RESTART_SECONDS) {
      resetIterator(target)
    }

    lastRequestedTime = target

    try {
      return await advanceTo(target)
    } catch (error) {
      // A decode/flush hiccup: restart once at the requested time before giving up.
      log.debug('ProRes preview decode error, restarting stream', { error })
      resetIterator(target)
      lastRequestedTime = target
      return await advanceTo(target)
    }
  }

  return {
    getSampleForTime(timeSeconds: number): Promise<VideoSample | null> {
      const run = chain.then(() => runGetSample(timeSeconds))
      // Swallow errors on the chain copy so the next call still runs; the returned promise
      // still rejects for this caller.
      chain = run.catch(() => null)
      return run
    },

    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      // Wait for any in-flight decode to settle so we don't close the stream mid-advance.
      await chain.catch(() => null)
      closeStream()
      closeSample(currentSample)
      currentSample = null
      try {
        input.dispose()
      } catch {
        // Ignore dispose errors.
      }
    },
  }
}
