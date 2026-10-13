import { useCallback, useEffect, useRef, type PointerEvent } from 'react'
import {
  createScrubThrottleState,
  shouldCommitScrubFrame,
} from '@/features/editor/deps/timeline-utils'
import { usePlaybackStore } from '@/shared/state/playback'

export interface MiniTimelineScrubHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
}

/**
 * Fast-scrub engine shared by the Color navigator and Animate strip. The
 * surface rect is captured once on pointer down (no per-move layout reads),
 * commits are rAF-batched and gated by the adaptive scrub throttle, and the
 * transient preview frame is updated during the drag without waking every
 * authoritative-current-frame consumer, and the exact pointer position is
 * committed on release. Spread the returned handlers onto the scrub surface.
 */
export function useMiniTimelineScrub({
  maxFrame,
  fps,
  labelWidth,
}: {
  maxFrame: number
  fps: number
  labelWidth: number
}): MiniTimelineScrubHandlers {
  const finishScrub = usePlaybackStore((s) => s.finishScrub)
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame)
  const setCompositionVisualFrozen = usePlaybackStore((s) => s.setCompositionVisualFrozen)
  const pausePlayback = usePlaybackStore((s) => s.pause)

  const isScrubbingRef = useRef(false)
  const scrubRectRef = useRef<DOMRect | null>(null)
  const scrubThrottleRef = useRef(createScrubThrottleState())
  const pendingClientXRef = useRef<number | null>(null)
  const scrubRafRef = useRef<number | null>(null)
  // Latest geometry in refs so the rAF loop / handlers read fresh values
  // without being recreated on every frame-count change.
  const maxFrameRef = useRef(maxFrame)
  maxFrameRef.current = maxFrame
  const fpsRef = useRef(fps)
  fpsRef.current = fps

  const clientXToFrame = useCallback(
    (clientX: number): number | null => {
      const rect = scrubRectRef.current
      if (!rect || rect.width <= 0) return null
      const timelineWidth = Math.max(1, rect.width - labelWidth)
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left - labelWidth) / timelineWidth))
      return Math.round(ratio * maxFrameRef.current)
    },
    [labelWidth],
  )

  const cancelScrubRaf = useCallback(() => {
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current)
      scrubRafRef.current = null
    }
    pendingClientXRef.current = null
  }, [])

  useEffect(
    () => () => {
      cancelScrubRaf()
      if (isScrubbingRef.current) {
        usePlaybackStore.getState().setCompositionVisualFrozen(false)
      }
    },
    [cancelScrubRaf],
  )

  const runScrubLoop = useCallback(() => {
    const clientX = pendingClientXRef.current
    const rect = scrubRectRef.current
    if (!isScrubbingRef.current || clientX === null || !rect) {
      scrubRafRef.current = null
      return
    }
    const frame = clientXToFrame(clientX)
    if (frame !== null) {
      const timelineWidth = Math.max(1, rect.width - labelWidth)
      const safeFps = fpsRef.current > 0 ? fpsRef.current : 30
      const pixelsPerSecond = (timelineWidth * safeFps) / Math.max(1, maxFrameRef.current)
      const nowMs = performance.now()
      if (
        shouldCommitScrubFrame({
          state: scrubThrottleRef.current,
          pointerX: clientX - rect.left - labelWidth,
          targetFrame: frame,
          pixelsPerSecond,
          nowMs,
          overview: true,
        })
      ) {
        setPreviewFrame(frame, null)
      }
    }
    scrubRafRef.current = requestAnimationFrame(runScrubLoop)
  }, [clientXToFrame, labelWidth, setPreviewFrame])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      isScrubbingRef.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      scrubRectRef.current = event.currentTarget.getBoundingClientRect()
      const frame = clientXToFrame(event.clientX)
      if (frame === null) return
      pausePlayback()
      setCompositionVisualFrozen(true)
      pendingClientXRef.current = event.clientX
      scrubThrottleRef.current = createScrubThrottleState({
        pointerX: event.clientX - scrubRectRef.current.left - labelWidth,
        frame,
        nowMs: performance.now(),
      })
      setPreviewFrame(frame, null)
      if (scrubRafRef.current === null) {
        scrubRafRef.current = requestAnimationFrame(runScrubLoop)
      }
    },
    [
      clientXToFrame,
      labelWidth,
      pausePlayback,
      runScrubLoop,
      setCompositionVisualFrozen,
      setPreviewFrame,
    ],
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return
    pendingClientXRef.current = event.clientX
  }, [])

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      cancelScrubRaf()
      const frame = clientXToFrame(event.clientX)
      if (frame !== null) finishScrub(frame)
      isScrubbingRef.current = false
      scrubRectRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (frame === null) {
        setPreviewFrame(null)
        setCompositionVisualFrozen(false)
      }
    },
    [cancelScrubRaf, clientXToFrame, finishScrub, setCompositionVisualFrozen, setPreviewFrame],
  )

  const onPointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      cancelScrubRaf()
      isScrubbingRef.current = false
      scrubRectRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPreviewFrame(null)
      setCompositionVisualFrozen(false)
    },
    [cancelScrubRaf, setCompositionVisualFrozen, setPreviewFrame],
  )

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
