/**
 * Dopesheet marquee hook.
 * Owns the marquee rectangle, the in-progress drag-select state, the
 * click-dedup flag, and the global pointer listeners that drive both
 * marquee dragging and the auto-scroll-on-edge behavior. Started by
 * the orchestrator's row / timeline-background pointer-down handlers
 * via beginMarqueeSelection.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { KEYFRAME_MARQUEE_THRESHOLD, type KeyframeMarqueeRect } from '../keyframe-marquee'
import { resolveMarqueeSelection } from '../marquee-selection'
import { MARQUEE_SCROLL_EDGE_PX, MARQUEE_SCROLL_MAX_SPEED } from './dopesheet-constants'
import { addWindowPointerListeners } from './dopesheet-pointer-listeners'
import type { MarqueeMode, MarqueeState } from './dopesheet-types'

interface KeyframePoint {
  keyframeId: string
  x: number
  y: number
}

interface UseDopesheetMarqueeOptions {
  keyframePointsRef: React.RefObject<KeyframePoint[]>
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
  getTimelineXFromClientX: (clientX: number) => number
  getContentYFromClientY: (clientY: number) => number
  onSelectionChange?: (keyframeIds: Set<string>) => void
}

export interface UseDopesheetMarqueeReturn {
  marqueeRect: KeyframeMarqueeRect | null
  marqueeStateRef: React.RefObject<MarqueeState | null>
  marqueeJustEndedRef: React.RefObject<boolean>
  getMarqueeModeFromPointerEvent: (
    event: Pick<React.PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
  ) => MarqueeMode
  beginMarqueeSelection: (
    pointerId: number,
    clientX: number,
    clientY: number,
    mode: MarqueeMode,
    baseSelection: Set<string>,
  ) => void
}

export function useDopesheetMarquee({
  keyframePointsRef,
  scrollAreaRef,
  getTimelineXFromClientX,
  getContentYFromClientY,
  onSelectionChange,
}: UseDopesheetMarqueeOptions): UseDopesheetMarqueeReturn {
  const [marqueeRect, setMarqueeRect] = useState<KeyframeMarqueeRect | null>(null)
  const marqueeStateRef = useRef<MarqueeState | null>(null)
  const marqueeJustEndedRef = useRef(false)

  const onSelectionChangeRef = useRef(onSelectionChange)
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const getMarqueeModeFromPointerEvent = useCallback(
    (event: Pick<React.PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): MarqueeMode =>
      event.shiftKey ? 'add' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
    [],
  )

  const beginMarqueeSelection = useCallback(
    (
      pointerId: number,
      clientX: number,
      clientY: number,
      mode: MarqueeMode,
      baseSelection: Set<string>,
    ) => {
      const startX = getTimelineXFromClientX(clientX)
      const startY = getContentYFromClientY(clientY)
      marqueeStateRef.current = {
        pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        mode,
        baseSelection,
        started: false,
      }
    },
    [getContentYFromClientY, getTimelineXFromClientX],
  )

  const updateSelectionFromMarquee = useCallback(
    (state: MarqueeState) => {
      const minX = Math.min(state.startX, state.currentX)
      const maxX = Math.max(state.startX, state.currentX)
      const minY = Math.min(state.startY, state.currentY)
      const maxY = Math.max(state.startY, state.currentY)

      const hitIds = new Set<string>()
      for (const point of keyframePointsRef.current) {
        if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
          hitIds.add(point.keyframeId)
        }
      }

      const nextSelection = resolveMarqueeSelection(state.mode, state.baseSelection, hitIds)

      onSelectionChangeRef.current?.(nextSelection)
      setMarqueeRect({
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      })
    },
    [keyframePointsRef],
  )

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return

      const scrollNode = scrollAreaRef.current
      if (scrollNode) {
        const rect = scrollNode.getBoundingClientRect()
        const topEdge = rect.top + MARQUEE_SCROLL_EDGE_PX
        const bottomEdge = rect.bottom - MARQUEE_SCROLL_EDGE_PX
        let scrollDelta = 0

        if (event.clientY < topEdge) {
          const intensity = Math.min(1, (topEdge - event.clientY) / MARQUEE_SCROLL_EDGE_PX)
          scrollDelta = -Math.max(1, Math.round(intensity * MARQUEE_SCROLL_MAX_SPEED))
        } else if (event.clientY > bottomEdge) {
          const intensity = Math.min(1, (event.clientY - bottomEdge) / MARQUEE_SCROLL_EDGE_PX)
          scrollDelta = Math.max(1, Math.round(intensity * MARQUEE_SCROLL_MAX_SPEED))
        }

        if (scrollDelta !== 0) {
          const maxScrollTop = Math.max(0, scrollNode.scrollHeight - scrollNode.clientHeight)
          scrollNode.scrollTop = Math.max(
            0,
            Math.min(maxScrollTop, scrollNode.scrollTop + scrollDelta),
          )
        }
      }

      const x = getTimelineXFromClientX(event.clientX)
      const y = getContentYFromClientY(event.clientY)
      const movedEnough =
        Math.abs(x - marqueeState.startX) > KEYFRAME_MARQUEE_THRESHOLD ||
        Math.abs(y - marqueeState.startY) > KEYFRAME_MARQUEE_THRESHOLD
      if (!marqueeState.started && movedEnough) {
        marqueeState.started = true
      }
      if (!marqueeState.started) return

      marqueeState.currentX = x
      marqueeState.currentY = y
      updateSelectionFromMarquee(marqueeState)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return
      if (marqueeState.started) {
        marqueeJustEndedRef.current = true
        setTimeout(() => {
          marqueeJustEndedRef.current = false
        }, 100)
      } else if (marqueeState.mode === 'replace') {
        onSelectionChangeRef.current?.(new Set())
      }
      marqueeStateRef.current = null
      setMarqueeRect(null)
    }

    return addWindowPointerListeners(handlePointerMove, handlePointerUp)
  }, [getTimelineXFromClientX, getContentYFromClientY, updateSelectionFromMarquee, scrollAreaRef])

  return {
    marqueeRect,
    marqueeStateRef,
    marqueeJustEndedRef,
    getMarqueeModeFromPointerEvent,
    beginMarqueeSelection,
  }
}
