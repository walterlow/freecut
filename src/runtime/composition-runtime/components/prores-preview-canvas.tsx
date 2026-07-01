import React, { memo, useCallback, useEffect, useRef } from 'react'
import { useClock, useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useVideoConfig } from '../hooks/use-player-compat'
import { getVideoTargetTimeSeconds } from '../utils/video-timing'
import type { ProResPreviewSession } from '@/infrastructure/browser/prores-preview-session'
import { acquireProResSession } from '@/infrastructure/browser/prores-sink-cache'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('ProResPreviewCanvas')

/**
 * Upper bound on the preview canvas backing-store width. The player preview area is far
 * smaller than a 4K source, so a 4K backing store just burns memory bandwidth on every
 * composite. Drawing downscaled to this width keeps preview quality while cutting the
 * per-frame draw/composite cost for high-res ProRes. Export and thumbnails decode at full
 * resolution through their own paths — this only caps the on-screen preview.
 */
const MAX_PREVIEW_WIDTH = 1920

interface ProResPreviewState {
  session: ProResPreviewSession | null
  disposed: boolean
  /** True while a decode+draw is in flight, so ticks coalesce instead of piling up. */
  rendering: boolean
  /** Latest local frame requested while a render was in flight; drives one re-run. */
  queuedLocalFrame: number | null
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

    // Decode one local (sequence-relative) frame and paint it. The session owns the returned
    // sample (borrowed), so it is never closed here.
    const drawOnce = useCallback(
      async (state: ProResPreviewState, localFrame: number): Promise<void> => {
        const session = state.session
        if (!session || state.disposed) return
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
        const sample = await session.getSampleForTime(targetTime)
        if (state.disposed || !sample) return

        // Coalescing (see `render`) guarantees this is the latest requested frame, so it is
        // always the one to paint — no stale-draw guard needed.
        const canvas = canvasRef.current
        if (canvas) {
          // Cap the backing store so we don't allocate and composite a full 4K canvas every
          // frame for a preview area that is far smaller. Drawing the decoded frame
          // downscaled to ~1080p cuts per-frame draw + compositor cost ~4x for 4K sources
          // with no visible loss at preview size (a single 2x downscale, well clear of the
          // moire territory that only bites tiny thumbnail jumps). CSS `objectFit: fill`
          // still stretches the canvas to the container.
          const scale = Math.min(1, MAX_PREVIEW_WIDTH / sample.displayWidth)
          const drawWidth = Math.max(1, Math.round(sample.displayWidth * scale))
          const drawHeight = Math.max(1, Math.round(sample.displayHeight * scale))
          if (canvas.width !== drawWidth) canvas.width = drawWidth
          if (canvas.height !== drawHeight) canvas.height = drawHeight
          const ctx = canvas.getContext('2d')
          if (ctx) {
            sample.draw(ctx, 0, 0, drawWidth, drawHeight)
          }
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
      ],
    )

    // Draw the given local frame, coalescing ticks that arrive mid-decode onto a single
    // re-run targeting the latest frame, so work never piles up behind a slow decode. The
    // session holds a warm decoder and pulls its forward stream to the target, so each tick
    // only decodes the frames between the last draw and now.
    const render = useCallback(
      async (state: ProResPreviewState, localFrame: number): Promise<void> => {
        if (!state.session || state.disposed) return
        if (state.rendering) {
          state.queuedLocalFrame = localFrame
          return
        }
        state.rendering = true
        try {
          let frame = localFrame
          while (!state.disposed) {
            try {
              await drawOnce(state, frame)
            } catch (error) {
              log.warn('ProRes preview decode failed', { itemId, error })
              onErrorRef.current(error instanceof Error ? error : new Error(String(error)))
            }
            const next = state.queuedLocalFrame
            if (next === null) break
            state.queuedLocalFrame = null
            frame = next
          }
        } finally {
          state.rendering = false
        }
      },
      [drawOnce, itemId],
    )

    // Latest values for the imperative clock callback, which subscribes once and must
    // not capture stale closures.
    const renderRef = useRef(render)
    renderRef.current = render
    const clockRef = useRef(clock)
    clockRef.current = clock
    const seqFromRef = useRef(sequenceAbsoluteFrom)
    seqFromRef.current = sequenceAbsoluteFrom

    // Acquire a warm decode session for this source. The session cache keeps the decoder
    // and its forward stream alive across mount/unmount, so re-entering a clip (e.g. the
    // playhead crossing into it during playback after a prior seek) reuses the warm decoder
    // and paints immediately instead of cold-starting to black.
    useEffect(() => {
      const state: ProResPreviewState = {
        session: null,
        disposed: false,
        rendering: false,
        queuedLocalFrame: null,
      }
      stateRef.current = state

      const lease = acquireProResSession(src)
      void lease.session
        .then((session) => {
          if (state.disposed) return
          if (!session) {
            onErrorRef.current(new Error('ProRes source could not be opened'))
            return
          }
          state.session = session
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
        // The session is shared and kept warm by the cache — release our hold, don't close.
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
      if (state?.session) void render(state, clock.currentFrame - sequenceAbsoluteFrom)
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
