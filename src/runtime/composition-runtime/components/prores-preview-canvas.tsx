import type { VideoSample } from 'mediabunny'
import React, { useCallback, useEffect, useRef } from 'react'
import { useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useVideoConfig } from '../hooks/use-player-compat'
import { getVideoTargetTimeSeconds } from '../utils/video-timing'
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import {
  createProResSampleSink,
  detectProResTrack,
  type ProResSampleSink,
} from '@/infrastructure/browser/prores-sample-sink'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('ProResPreviewCanvas')

/**
 * How many source frames ahead of the playhead to decode speculatively. turbores
 * decodes a 4K frame in well under the frame budget (~12ms with workers), so the
 * bottleneck during playback is the per-tick main-thread work — the plane copy,
 * `VideoFrame` construction and canvas draw. Decoding the next frames ahead of time
 * moves the decode + copy + `VideoFrame` construction off the critical tick (overlapping
 * the compositor), leaving each tick to do only a cheap `sample.draw()` on a sample that
 * is usually already cached. Kept small: a handful of cached 4K samples is plenty to
 * stay ahead, and decoding too many at once thrashes memory and slows throughput.
 */
const LOOKAHEAD = 2

/**
 * Upper bound on the preview canvas backing-store width. The player preview area is far
 * smaller than a 4K source, so a 4K backing store just burns memory bandwidth on every
 * composite. Drawing downscaled to this width keeps preview quality while cutting the
 * per-frame draw/composite cost for high-res ProRes. Export and thumbnails decode at full
 * resolution through their own paths — this only caps the on-screen preview.
 */
const MAX_PREVIEW_WIDTH = 1920

interface ProResPreviewState {
  sink: ProResSampleSink | null
  input: { dispose?: () => void } | null
  disposed: boolean
  /** Decoded samples keyed by source frame index, ready to draw. */
  cache: Map<number, VideoSample>
  /** In-flight decodes keyed by source frame index, so we never decode one twice. */
  inflight: Map<number, Promise<VideoSample | null>>
  /**
   * Serializes access to the sink. Concurrent `getPacket` on a single mediabunny
   * `EncodedPacketSink` is not safe, so the current decode and any lookahead decodes
   * run one at a time, chained off this promise. Per-frame decode is fast enough
   * (~12ms at 4K) that serial decoding still stays well ahead of the playhead.
   */
  decodeChain: Promise<unknown>
  /** The frame index the latest render asked for; used to drop superseded draws. */
  currentFrameIndex: number
}

/**
 * DOM-layer preview for ProRes clips, which the browser cannot decode through a
 * `<video>` element (off-Safari). Mirrors {@link NativePreviewVideo}'s source-time
 * derivation, but decodes the frame at the current time via turbores and paints it to
 * a `<canvas>` mounted in the clip container. ProRes is all-intra, so every frame is a
 * standalone seek; a small {@link LOOKAHEAD} cache keeps the next frames decoded ahead
 * of the playhead so steady playback only pays for a canvas draw per tick.
 */
export const ProResPreviewCanvas: React.FC<{
  itemId: string
  src: string
  safeTrimBefore: number
  sequenceFrameOffset?: number
  sourceFps: number
  playbackRate: number
  isReversed?: boolean
  reverseSourceEnd?: number
  onError: (error: Error) => void
}> = ({
  itemId,
  src,
  safeTrimBefore,
  sequenceFrameOffset = 0,
  sourceFps,
  playbackRate,
  isReversed = false,
  reverseSourceEnd,
  onError,
}) => {
  const frame = useSequenceContext()?.localFrame ?? 0
  const { fps } = useVideoConfig()

  const targetTime = getVideoTargetTimeSeconds(
    safeTrimBefore,
    sourceFps,
    frame,
    playbackRate,
    fps,
    sequenceFrameOffset,
    isReversed,
    reverseSourceEnd,
  )

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<ProResPreviewState | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Decode (or reuse) the sample for a source frame index. Coalesces concurrent
  // requests for the same index and caches the result for the draw loop / lookahead.
  const decodeFrame = useCallback(
    (state: ProResPreviewState, frameIndex: number): Promise<VideoSample | null> => {
      const cached = state.cache.get(frameIndex)
      if (cached) return Promise.resolve(cached)
      const existing = state.inflight.get(frameIndex)
      if (existing) return existing

      // ProRes is constant-rate and all-intra: the packet covering this time is the
      // frame we want. Query at the frame's start time, serialized behind decodeChain.
      const run = state.decodeChain.then(async () => {
        if (state.disposed || !state.sink) return null
        const time = Math.max(0, frameIndex) / sourceFps
        const { value } = await state.sink.samplesAtTimestamps([time]).next()
        return (value ?? null) as VideoSample | null
      })
      // Keep the chain alive past failures so one bad decode doesn't wedge playback.
      state.decodeChain = run.catch(() => null)

      const promise = run
        .then((sample) => {
          state.inflight.delete(frameIndex)
          if (state.disposed) {
            sample?.close()
            return null
          }
          if (sample) state.cache.set(frameIndex, sample)
          return sample
        })
        .catch((error) => {
          state.inflight.delete(frameIndex)
          throw error
        })

      state.inflight.set(frameIndex, promise)
      return promise
    },
    [sourceFps],
  )

  // Close and drop cached samples outside the live window around the playhead so the
  // cache stays bounded (a few frames) regardless of scrubbing.
  const evict = useCallback((state: ProResPreviewState, center: number) => {
    const lo = center - 1
    const hi = center + LOOKAHEAD
    for (const [index, sample] of state.cache) {
      if (index < lo || index > hi) {
        sample.close()
        state.cache.delete(index)
      }
    }
  }, [])

  const render = useCallback(
    async (state: ProResPreviewState) => {
      if (!state.sink || state.disposed) return
      const frameIndex = Math.max(0, Math.round(targetTime * sourceFps))
      state.currentFrameIndex = frameIndex

      try {
        const sample = await decodeFrame(state, frameIndex)
        // A newer render superseded this one, or we were torn down mid-decode: don't
        // paint a stale frame (it stays cached for whoever needs it).
        if (state.disposed || state.currentFrameIndex !== frameIndex) return

        const canvas = canvasRef.current
        if (sample && canvas) {
          // Cap the backing store so we don't allocate and composite a full 4K canvas
          // every frame for a preview area that is far smaller. Drawing the decoded
          // frame downscaled to ~1080p cuts per-frame draw + compositor cost ~4x for 4K
          // sources with no visible loss at preview size (a single 2x downscale, well
          // clear of the moire territory that only bites tiny thumbnail jumps). CSS
          // `objectFit: fill` still stretches the canvas to the container.
          const scale = Math.min(1, MAX_PREVIEW_WIDTH / sample.displayWidth)
          const drawWidth = Math.max(1, Math.round(sample.displayWidth * scale))
          const drawHeight = Math.max(1, Math.round(sample.displayHeight * scale))
          if (canvas.width !== drawWidth) canvas.width = drawWidth
          if (canvas.height !== drawHeight) canvas.height = drawHeight
          const ctx = canvas.getContext('2d')
          if (ctx) sample.draw(ctx, 0, 0, drawWidth, drawHeight)
        }

        // Warm the next frames in the playback direction so the upcoming ticks hit the
        // cache. Best-effort: misses (rate changes, seeks) just decode on demand.
        const step = isReversed ? -1 : 1
        for (let i = 1; i <= LOOKAHEAD; i++) {
          const ahead = frameIndex + step * i
          if (ahead >= 0) void decodeFrame(state, ahead).catch(() => {})
        }
        evict(state, frameIndex)
      } catch (error) {
        log.warn('ProRes preview decode failed', { itemId, error })
        onErrorRef.current(error instanceof Error ? error : new Error(String(error)))
      }
    },
    [targetTime, sourceFps, isReversed, decodeFrame, evict, itemId],
  )

  // Mount the canvas and open the turbores-backed source.
  useEffect(() => {
    const state: ProResPreviewState = {
      sink: null,
      input: null,
      disposed: false,
      cache: new Map(),
      inflight: new Map(),
      decodeChain: Promise.resolve(),
      currentFrameIndex: -1,
    }
    stateRef.current = state

    void (async () => {
      try {
        const mb = await import('mediabunny')
        const input = new mb.Input({
          formats: mb.ALL_FORMATS,
          source: createMediabunnyInputSource(mb, src),
        })
        const track = await input.getPrimaryVideoTrack()
        if (!track) {
          throw new Error('No video track in ProRes source')
        }
        const info = await detectProResTrack(mb, track)
        if (!info) {
          throw new Error('Source is not a recognized ProRes track')
        }
        const sink = createProResSampleSink(mb, track, info)
        if (state.disposed) {
          await sink.close()
          input.dispose()
          return
        }
        state.input = input
        state.sink = sink
        // Paint the current frame now that the decoder is ready.
        void render(state)
      } catch (error) {
        if (!state.disposed) {
          onErrorRef.current(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })()

    return () => {
      state.disposed = true
      for (const sample of state.cache.values()) sample.close()
      state.cache.clear()
      void state.sink?.close()
      state.input?.dispose?.()
      if (stateRef.current === state) {
        stateRef.current = null
      }
    }
    // `render` is intentionally excluded: it changes every time `targetTime` updates,
    // and re-running mount/teardown on every frame would tear down the decoder. The
    // separate effect below drives rendering as `targetTime` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, itemId])

  // Request a draw whenever the source time changes.
  useEffect(() => {
    const state = stateRef.current
    if (state?.sink) void render(state)
  }, [render])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
    />
  )
}
