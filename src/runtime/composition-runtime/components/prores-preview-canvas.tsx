import type { VideoSample } from 'mediabunny'
import React, { memo, useCallback, useEffect, useRef } from 'react'
import { useClock, useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useVideoConfig } from '../hooks/use-player-compat'
import { getVideoTargetTimeSeconds } from '../utils/video-timing'
import type { ProResSampleSink } from '@/infrastructure/browser/prores-sample-sink'
import { acquireProResSink } from '@/infrastructure/browser/prores-sink-cache'
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
  /** Whether any frame has been painted yet (so the first frame always paints). */
  hasDrawn: boolean
  /** The frame index currently on the canvas; lets catch-up decodes paint forward. */
  lastDrawnIndex: number
}

interface ProResPreviewInnerProps {
  itemId: string
  src: string
  safeTrimBefore: number
  sequenceFrameOffset: number
  sourceFps: number
  playbackRate: number
  isReversed: boolean
  reverseSourceEnd?: number
  /** Absolute start frame of this clip's sequence, used to map clock frame → local frame. */
  sequenceAbsoluteFrom: number
  onError: (error: Error) => void
}

/**
 * Inner preview component. Decodes ProRes frames via turbores and paints them to a
 * `<canvas>`, driven **imperatively** by the player {@link Clock} rather than by React
 * renders. Reading the frame through `useSequenceContext` would re-render this component
 * every tick (the context value changes each frame), and that per-frame reconciliation —
 * not the decode — dominated 4K playback cost. Instead this subscribes to the clock's
 * `framechange` event and draws in the callback, so the component mounts once and never
 * re-renders during playback. A small {@link LOOKAHEAD} cache keeps upcoming frames
 * decoded ahead of the playhead so each tick only pays for a canvas draw.
 *
 * Memoized so the per-frame re-render of its thin wrapper (which does read the sequence
 * context) does not propagate here.
 */
const ProResPreviewCanvasInner = memo<ProResPreviewInnerProps>(
  ({
    itemId,
    src,
    safeTrimBefore,
    sequenceFrameOffset,
    sourceFps,
    playbackRate,
    isReversed,
    reverseSourceEnd,
    sequenceAbsoluteFrom,
    onError,
  }) => {
    const { fps } = useVideoConfig()
    const clock = useClock()

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

    // Draw the frame for a given local (sequence-relative) frame number. Called from the
    // clock subscription (per playback tick / seek) and from prop-change effects.
    const render = useCallback(
      async (state: ProResPreviewState, localFrame: number) => {
        if (!state.sink || state.disposed) return
        const targetTime = getVideoTargetTimeSeconds(
          safeTrimBefore,
          sourceFps,
          localFrame,
          playbackRate,
          fps,
          sequenceFrameOffset,
          isReversed,
          reverseSourceEnd,
        )
        const frameIndex = Math.max(0, Math.round(targetTime * sourceFps))
        state.currentFrameIndex = frameIndex

        try {
          const sample = await decodeFrame(state, frameIndex)
          if (state.disposed) return
          // Decide whether to paint this just-decoded frame. During playback the playhead
          // advances while the decode is in flight, so by the time it resolves a newer
          // frame is usually the "current" target. The old guard skipped any non-current
          // frame — which, on entry with a cold cache, dropped EVERY in-flight decode and
          // left the canvas black until throughput caught the moving playhead (while a
          // paused seek, with a still playhead, painted fine). Instead: always paint the
          // first frame, and thereafter paint the current target OR any frame that
          // advances in the playback direction. This keeps the canvas moving forward
          // through the catch-up instead of black, and still never flickers backward.
          if (state.hasDrawn) {
            const isCurrent = frameIndex === state.currentFrameIndex
            const advances = isReversed
              ? frameIndex < state.lastDrawnIndex
              : frameIndex > state.lastDrawnIndex
            if (!isCurrent && !advances) return
          }

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
            if (ctx) {
              sample.draw(ctx, 0, 0, drawWidth, drawHeight)
              state.hasDrawn = true
              state.lastDrawnIndex = frameIndex
            }
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
      [
        safeTrimBefore,
        sourceFps,
        playbackRate,
        fps,
        sequenceFrameOffset,
        isReversed,
        reverseSourceEnd,
        decodeFrame,
        evict,
        itemId,
      ],
    )

    // Latest values for the imperative clock callback, which subscribes once and must
    // not capture stale closures.
    const renderRef = useRef(render)
    renderRef.current = render
    const clockRef = useRef(clock)
    clockRef.current = clock
    const seqFromRef = useRef(sequenceAbsoluteFrom)
    seqFromRef.current = sequenceAbsoluteFrom

    // Acquire a warm turbores sink for this source. The sink cache keeps the decoder
    // alive across mount/unmount, so re-entering a clip (e.g. the playhead crossing into
    // it during playback after a prior seek) reuses the warm decoder and paints
    // immediately instead of cold-starting to black.
    useEffect(() => {
      const state: ProResPreviewState = {
        sink: null,
        disposed: false,
        cache: new Map(),
        inflight: new Map(),
        decodeChain: Promise.resolve(),
        currentFrameIndex: -1,
        hasDrawn: false,
        lastDrawnIndex: -1,
      }
      stateRef.current = state

      const lease = acquireProResSink(src)
      void lease.sink
        .then((sink) => {
          if (state.disposed) return
          if (!sink) {
            onErrorRef.current(new Error('ProRes source could not be opened'))
            return
          }
          state.sink = sink
          // Paint the current frame now that the decoder is ready.
          void renderRef.current(state, clockRef.current.currentFrame - seqFromRef.current)
        })
        .catch((error) => {
          if (!state.disposed) {
            onErrorRef.current(error instanceof Error ? error : new Error(String(error)))
          }
        })

      return () => {
        state.disposed = true
        // The sink is shared and kept warm by the cache — release our hold, don't close.
        for (const sample of state.cache.values()) sample.close()
        state.cache.clear()
        lease.release()
        if (stateRef.current === state) {
          stateRef.current = null
        }
      }
    }, [src])

    // Drive draws imperatively from the clock — no React re-render per frame. `seek`
    // also emits `framechange`, so this covers both playback and scrubbing.
    useEffect(() => {
      const unsubscribe = clock.onFrameChange((globalFrame) => {
        const state = stateRef.current
        if (state) void renderRef.current(state, globalFrame - seqFromRef.current)
      })
      return unsubscribe
    }, [clock])

    // Redraw the current frame when timing-affecting props change (e.g. a trim/move while
    // paused), since those emit no clock event.
    useEffect(() => {
      const state = stateRef.current
      if (state?.sink) void render(state, clock.currentFrame - sequenceAbsoluteFrom)
    }, [render, sequenceAbsoluteFrom, clock])

    return (
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
      />
    )
  },
)

ProResPreviewCanvasInner.displayName = 'ProResPreviewCanvasInner'

/**
 * DOM-layer preview for ProRes clips, which the browser cannot decode through a
 * `<video>` element (off-Safari). This thin wrapper reads the sequence context (whose
 * value changes every frame) and forwards the clip's absolute start frame plus a stable
 * `onError` to the memoized {@link ProResPreviewCanvasInner}. Keeping the context read
 * here means the inner component — which holds the decoder and canvas — is not torn down
 * or re-rendered every frame; it draws imperatively off the player clock instead.
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
  const sequenceAbsoluteFrom = useSequenceContext()?.from ?? 0

  // Stable onError so the wrapper's per-frame re-render does not bust the inner's memo.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const stableOnError = useCallback((error: Error) => onErrorRef.current(error), [])

  return (
    <ProResPreviewCanvasInner
      itemId={itemId}
      src={src}
      safeTrimBefore={safeTrimBefore}
      sequenceFrameOffset={sequenceFrameOffset}
      sourceFps={sourceFps}
      playbackRate={playbackRate}
      isReversed={isReversed}
      reverseSourceEnd={reverseSourceEnd}
      sequenceAbsoluteFrom={sequenceAbsoluteFrom}
      onError={stableOnError}
    />
  )
}
