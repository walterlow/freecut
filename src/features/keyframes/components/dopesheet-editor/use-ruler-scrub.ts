import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  getTimelineScrubViewportProgress,
  notifyTimelineScrubVisualFrame,
} from '@/shared/timeline/live-scroll-sync'
import {
  beginTimelineSkimmerScrub,
  endTimelineSkimmerScrub,
} from '@/shared/timeline/main-timeline-scrub'
import {
  getEdgeScrollDelta,
  getPlayheadEdgeScrollVelocity,
} from '@/features/keyframes/deps/timeline-playhead'
import { useCoalescedScrub } from '../use-coalesced-scrub'
import type { Viewport } from './dopesheet-types'
import { setPointerCaptureSafely } from './dopesheet-utils'
import { clampFrame } from './frame-utils'
import { getFrameFromAxisX } from './layout'

/** Frame under the pointer, derived from the live scroll geometry when available. */
function getLiveRulerFrame({
  viewportX,
  fallbackFrame,
  scrollContainer,
  livePixelsPerSecond,
  fps,
  itemFrom,
}: {
  viewportX: number
  fallbackFrame: number
  scrollContainer: HTMLDivElement | null | undefined
  livePixelsPerSecond: number | undefined
  fps: number
  itemFrom: number
}): number {
  if (!scrollContainer || !livePixelsPerSecond || livePixelsPerSecond <= 0) return fallbackFrame
  return Math.round(
    ((scrollContainer.scrollLeft + viewportX) / livePixelsPerSecond) * fps - itemFrom,
  )
}

function getDopesheetTimelineClientBounds(
  node: HTMLDivElement,
  borderWidth: number,
  timelineWidth: number,
): { left: number; right: number } {
  const left = node.getBoundingClientRect().left + borderWidth
  return { left, right: left + timelineWidth }
}

export interface UseRulerScrubParams {
  disabled: boolean
  viewport: Viewport
  effectiveTimelineWidth: number
  timelinePixelsPerSecond: number
  fps: number
  itemFrom: number
  totalFrames: number
  timelineEdgeInset: number | undefined
  timelineCellBorderWidth: number
  scrubClampToItemBounds: boolean
  scrubFrameBounds: { minFrame: number; maxFrame: number } | null | undefined
  frameToX: (frame: number) => number
  globalFrameToPixels?: (frame: number) => number
  getTimelineXFromClientX: (clientX: number) => number
  getFrameFromClientX: (clientX: number) => number
  getLiveDragPixelsPerFrame: () => number
  getTimelineLivePixelsPerSecond?: () => number | undefined
  timelineRef: RefObject<HTMLDivElement | null>
  timelineScrollContainerRef?: RefObject<HTMLDivElement | null>
  onScrub?: (frame: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
  onSkim?: (frame: number | null) => void
  /** Applies a horizontal scroll of the linked timeline; returns pixels applied. */
  onRulerEdgeScroll?: (deltaPixels: number) => number
}

export interface RulerScrub {
  isRulerScrubbing: boolean
  rulerScrubActiveRef: RefObject<boolean>
  rulerScrubHandoffFrameRef: RefObject<number | null>
  handleRulerPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handleRulerPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handleRulerPointerLeave: () => void
  handleRulerPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
}

/**
 * Ruler scrubbing for the dopesheet: the pointer drags the playhead, and holding
 * it near either edge auto-scrolls the linked timeline on an animation frame while
 * the scrub follows the scroll.
 *
 * Two render-time rebindings are deliberate and must survive any refactor:
 * `rulerScrubViewportRef` tracks the current viewport while no drag is active, and
 * `rulerEdgeScrollLoopRef` is reassigned every render so the rAF loop reads this
 * render's geometry instead of a stale closure.
 */
export function useRulerScrub(params: UseRulerScrubParams): RulerScrub {
  const {
    disabled,
    viewport,
    effectiveTimelineWidth,
    timelinePixelsPerSecond,
    fps,
    itemFrom,
    totalFrames,
    timelineEdgeInset,
    timelineCellBorderWidth,
    scrubClampToItemBounds,
    scrubFrameBounds,
    frameToX,
    globalFrameToPixels,
    getTimelineXFromClientX,
    getFrameFromClientX,
    getLiveDragPixelsPerFrame,
    getTimelineLivePixelsPerSecond,
    timelineRef,
    timelineScrollContainerRef,
    onScrub,
    onScrubStart,
    onScrubEnd,
    onSkim,
    onRulerEdgeScroll,
  } = params

  const scrubPointerIdRef = useRef<number | null>(null)
  const rulerScrubActiveRef = useRef(false)
  const rulerScrubHandoffFrameRef = useRef<number | null>(null)
  const [isRulerScrubbing, setIsRulerScrubbing] = useState(false)
  const lastScrubbedFrameRef = useRef<number | null>(null)
  const rulerScrubClientXRef = useRef<number | null>(null)
  const rulerScrubViewportRef = useRef(viewport)
  const rulerEdgeScrollRafRef = useRef<number | null>(null)
  const rulerEdgeScrollTimestampRef = useRef<number | null>(null)
  const rulerEdgeScrollLoopRef = useRef<(timestamp: number) => void>(() => {})
  const skimmerScrubOwnerRef = useRef({})

  const getRulerFrameViewportX = useCallback(
    (frame: number) => {
      const mappedX = globalFrameToPixels ? globalFrameToPixels(itemFrom + frame) : frameToX(frame)
      return Math.max(0, Math.min(effectiveTimelineWidth - 1, mappedX))
    },
    [effectiveTimelineWidth, frameToX, globalFrameToPixels, itemFrom],
  )

  const getRulerScrubVisualX = useCallback(
    (clientX: number) => {
      const pointerX = getTimelineXFromClientX(clientX)
      if (scrubClampToItemBounds) {
        return Math.max(
          getRulerFrameViewportX(0),
          Math.min(getRulerFrameViewportX(Math.max(0, totalFrames - 1)), pointerX),
        )
      }
      if (scrubFrameBounds) {
        return Math.max(
          getRulerFrameViewportX(scrubFrameBounds.minFrame),
          Math.min(getRulerFrameViewportX(scrubFrameBounds.maxFrame), pointerX),
        )
      }
      return pointerX
    },
    [
      getRulerFrameViewportX,
      getTimelineXFromClientX,
      scrubClampToItemBounds,
      scrubFrameBounds,
      totalFrames,
    ],
  )

  const notifyLinkedTimelineScrubFrame = useCallback(
    (frame: number, clientX: number) =>
      notifyTimelineScrubVisualFrame(timelineScrollContainerRef?.current, {
        frame: itemFrom + frame,
        source: 'keyframe',
        viewportProgress: getTimelineScrubViewportProgress(
          getRulerScrubVisualX(clientX),
          effectiveTimelineWidth - 1,
        ),
      }),
    [effectiveTimelineWidth, getRulerScrubVisualX, itemFrom, timelineScrollContainerRef],
  )

  if (scrubPointerIdRef.current === null) rulerScrubViewportRef.current = viewport

  const {
    startScrub: startRulerScrub,
    queueScrub: queueRulerScrub,
    flushPendingScrub: flushPendingRulerScrub,
  } = useCoalescedScrub((frame: number) => onScrub?.(frame))

  const getRulerScrubFrameFromClientX = useCallback(
    (clientX: number) => {
      const viewportX = getTimelineXFromClientX(clientX)
      const fallbackFrame = getFrameFromAxisX(
        viewportX,
        rulerScrubViewportRef.current,
        effectiveTimelineWidth,
        timelineEdgeInset,
      )
      const frame = getLiveRulerFrame({
        viewportX,
        fallbackFrame,
        scrollContainer: timelineScrollContainerRef?.current,
        livePixelsPerSecond: getTimelineLivePixelsPerSecond?.(),
        fps,
        itemFrom,
      })
      if (scrubClampToItemBounds) return clampFrame(frame, totalFrames)
      if (!scrubFrameBounds) return frame
      return Math.max(scrubFrameBounds.minFrame, Math.min(scrubFrameBounds.maxFrame, frame))
    },
    [
      effectiveTimelineWidth,
      fps,
      getTimelineLivePixelsPerSecond,
      getTimelineXFromClientX,
      itemFrom,
      scrubClampToItemBounds,
      scrubFrameBounds,
      timelineEdgeInset,
      timelineScrollContainerRef,
      totalFrames,
    ],
  )

  rulerEdgeScrollLoopRef.current = (timestamp: number) => {
    rulerEdgeScrollRafRef.current = null
    const clientX = rulerScrubClientXRef.current
    const node = timelineRef.current
    if (scrubPointerIdRef.current === null || clientX === null || !node || !onRulerEdgeScroll) {
      return
    }

    const bounds = getDopesheetTimelineClientBounds(
      node,
      timelineCellBorderWidth,
      effectiveTimelineWidth,
    )
    const velocity = getPlayheadEdgeScrollVelocity(clientX, bounds)
    if (velocity !== 0) {
      const previousTimestamp = rulerEdgeScrollTimestampRef.current ?? timestamp - 1000 / 60
      const appliedPixels = onRulerEdgeScroll(
        getEdgeScrollDelta(velocity, timestamp, previousTimestamp),
      )
      if (appliedPixels !== 0 && effectiveTimelineWidth > 0) {
        const liveViewport = rulerScrubViewportRef.current
        const frameDelta = appliedPixels / getLiveDragPixelsPerFrame()
        rulerScrubViewportRef.current = {
          startFrame: liveViewport.startFrame + frameDelta,
          endFrame: liveViewport.endFrame + frameDelta,
        }
        const frame = getRulerScrubFrameFromClientX(clientX)
        lastScrubbedFrameRef.current = frame
        notifyLinkedTimelineScrubFrame(frame, clientX)
        queueRulerScrub({
          frame,
          pointerX: getTimelineXFromClientX(clientX),
          pixelsPerSecond: timelinePixelsPerSecond,
        })
      }
      rulerEdgeScrollTimestampRef.current = timestamp
    } else {
      rulerEdgeScrollTimestampRef.current = null
    }

    rulerEdgeScrollRafRef.current = requestAnimationFrame((nextTimestamp) =>
      rulerEdgeScrollLoopRef.current(nextTimestamp),
    )
  }

  useEffect(() => {
    const skimmerScrubOwner = skimmerScrubOwnerRef.current
    return () => {
      if (rulerEdgeScrollRafRef.current !== null) {
        cancelAnimationFrame(rulerEdgeScrollRafRef.current)
      }
      if (scrubPointerIdRef.current !== null) {
        rulerScrubActiveRef.current = false
      }
      endTimelineSkimmerScrub(skimmerScrubOwner)
    }
  }, [])

  const handleRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return
      event.preventDefault()
      rulerScrubHandoffFrameRef.current = null
      rulerScrubActiveRef.current = true
      beginTimelineSkimmerScrub(skimmerScrubOwnerRef.current)
      setIsRulerScrubbing(true)
      scrubPointerIdRef.current = event.pointerId
      rulerScrubClientXRef.current = event.clientX
      rulerScrubViewportRef.current = viewport
      rulerEdgeScrollTimestampRef.current = null
      setPointerCaptureSafely(event.currentTarget, event.pointerId)
      const frame = getRulerScrubFrameFromClientX(event.clientX)
      lastScrubbedFrameRef.current = frame
      notifyLinkedTimelineScrubFrame(frame, event.clientX)
      onScrubStart?.()
      startRulerScrub({
        frame,
        pointerX: getTimelineXFromClientX(event.clientX),
        pixelsPerSecond: timelinePixelsPerSecond,
      })
      if (onRulerEdgeScroll && rulerEdgeScrollRafRef.current === null) {
        rulerEdgeScrollRafRef.current = requestAnimationFrame((timestamp) =>
          rulerEdgeScrollLoopRef.current(timestamp),
        )
      }
    },
    [
      disabled,
      getRulerScrubFrameFromClientX,
      getTimelineXFromClientX,
      notifyLinkedTimelineScrubFrame,
      onRulerEdgeScroll,
      onScrubStart,
      startRulerScrub,
      timelinePixelsPerSecond,
      viewport,
    ],
  )

  const handleRulerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      const frame = getFrameFromClientX(event.clientX)
      onSkim?.(frame)
      if (scrubPointerIdRef.current !== event.pointerId) return
      rulerScrubClientXRef.current = event.clientX
      const scrubFrame = getRulerScrubFrameFromClientX(event.clientX)
      notifyLinkedTimelineScrubFrame(scrubFrame, event.clientX)
      if (scrubFrame === lastScrubbedFrameRef.current) return
      lastScrubbedFrameRef.current = scrubFrame
      queueRulerScrub({
        frame: scrubFrame,
        pointerX: getTimelineXFromClientX(event.clientX),
        pixelsPerSecond: timelinePixelsPerSecond,
      })
    },
    [
      disabled,
      getFrameFromClientX,
      getRulerScrubFrameFromClientX,
      getTimelineXFromClientX,
      notifyLinkedTimelineScrubFrame,
      onSkim,
      queueRulerScrub,
      timelinePixelsPerSecond,
    ],
  )

  const handleRulerPointerLeave = useCallback(() => {
    if (scrubPointerIdRef.current === null) onSkim?.(null)
  }, [onSkim])

  const handleRulerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scrubPointerIdRef.current !== event.pointerId) return
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore pointer capture errors
      }
      const finalFrame = getRulerScrubFrameFromClientX(event.clientX)
      rulerScrubHandoffFrameRef.current = finalFrame
      notifyLinkedTimelineScrubFrame(finalFrame, event.clientX)
      if (finalFrame !== lastScrubbedFrameRef.current) {
        queueRulerScrub({
          frame: finalFrame,
          pointerX: getTimelineXFromClientX(event.clientX),
          pixelsPerSecond: timelinePixelsPerSecond,
        })
      }
      if (rulerEdgeScrollRafRef.current !== null) {
        cancelAnimationFrame(rulerEdgeScrollRafRef.current)
        rulerEdgeScrollRafRef.current = null
      }
      setIsRulerScrubbing(false)
      scrubPointerIdRef.current = null
      rulerScrubClientXRef.current = null
      rulerEdgeScrollTimestampRef.current = null
      lastScrubbedFrameRef.current = null
      flushPendingRulerScrub(true)
      rulerScrubActiveRef.current = false
      onScrubEnd?.()
      endTimelineSkimmerScrub(skimmerScrubOwnerRef.current)
    },
    [
      flushPendingRulerScrub,
      getRulerScrubFrameFromClientX,
      getTimelineXFromClientX,
      notifyLinkedTimelineScrubFrame,
      onScrubEnd,
      queueRulerScrub,
      timelinePixelsPerSecond,
    ],
  )

  return {
    isRulerScrubbing,
    rulerScrubActiveRef,
    rulerScrubHandoffFrameRef,
    handleRulerPointerDown,
    handleRulerPointerMove,
    handleRulerPointerLeave,
    handleRulerPointerUp,
  }
}
