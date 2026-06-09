/**
 * Marquee selection hook.
 * Owns the marquee rectangle, its drag-to-select state, and the
 * global pointer listeners that drive it. Started by
 * handleBackgroundPointerDown; produces selection changes via
 * onSelectionChange and a visible rect via marqueeRect.
 *
 * Shares svgRef and the two drag refs with the orchestrator so a marquee
 * does not start on top of an active keyframe or bezier-handle drag,
 * and so pointer capture cleanup in the orchestrator can see whether a
 * marquee was active.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { KEYFRAME_MARQUEE_THRESHOLD, type KeyframeMarqueeRect } from '../keyframe-marquee'
import { resolveMarqueeSelection } from '../marquee-selection'
import type { GraphKeyframePoint, GraphViewport } from './types'
import type {
  BezierDragStartState,
  DragStartState,
  MarqueeMode,
  MarqueeState,
} from './graph-interaction-types'

interface UseMarqueeOptions {
  disabled: boolean
  viewport: GraphViewport
  selectedKeyframeIds: Set<string>
  pointsRef: React.RefObject<GraphKeyframePoint[]>
  svgRef: React.RefObject<SVGSVGElement | null>
  dragStartRef: React.RefObject<DragStartState | null>
  bezierDragStartRef: React.RefObject<BezierDragStartState | null>
  onSelectionChange?: (keyframeIds: Set<string>) => void
}

export interface UseMarqueeReturn {
  marqueeRect: KeyframeMarqueeRect | null
  marqueeStateRef: React.RefObject<MarqueeState | null>
  marqueeJustEndedRef: React.RefObject<boolean>
  handleBackgroundPointerDown: (event: React.PointerEvent<SVGElement>) => void
}

export function useMarquee({
  disabled,
  viewport,
  selectedKeyframeIds,
  pointsRef,
  svgRef,
  dragStartRef,
  bezierDragStartRef,
  onSelectionChange,
}: UseMarqueeOptions): UseMarqueeReturn {
  const [marqueeRect, setMarqueeRect] = useState<KeyframeMarqueeRect | null>(null)
  const marqueeStateRef = useRef<MarqueeState | null>(null)
  const marqueeJustEndedRef = useRef(false)

  const onSelectionChangeRef = useRef(onSelectionChange)
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const updateSelectionFromMarquee = useCallback(
    (state: MarqueeState) => {
      const minX = Math.min(state.startX, state.currentX)
      const maxX = Math.max(state.startX, state.currentX)
      const minY = Math.min(state.startY, state.currentY)
      const maxY = Math.max(state.startY, state.currentY)

      const hitIds = new Set<string>()
      for (const point of pointsRef.current) {
        if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
          hitIds.add(point.keyframe.id)
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
    [pointsRef],
  )

  useEffect(() => {
    const handleMarqueePointerMove = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current
      const svg = svgRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId || !svg) return

      const rect = svg.getBoundingClientRect()
      const x = Math.max(0, Math.min(viewport.width, event.clientX - rect.left))
      const y = Math.max(0, Math.min(viewport.height, event.clientY - rect.top))

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

    const handleMarqueePointerUp = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return

      const svg = svgRef.current
      if (svg) {
        try {
          svg.releasePointerCapture(event.pointerId)
        } catch {
          // Pointer capture may already be released.
        }
      }

      if (marqueeState.started) {
        marqueeJustEndedRef.current = true
        setTimeout(() => {
          marqueeJustEndedRef.current = false
        }, 100)
      }

      marqueeStateRef.current = null
      svgRef.current = null
      setMarqueeRect(null)
    }

    window.addEventListener('pointermove', handleMarqueePointerMove)
    window.addEventListener('pointerup', handleMarqueePointerUp)

    return () => {
      window.removeEventListener('pointermove', handleMarqueePointerMove)
      window.removeEventListener('pointerup', handleMarqueePointerUp)
    }
  }, [updateSelectionFromMarquee, viewport.height, viewport.width, svgRef])

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<SVGElement>) => {
      if (disabled) return
      if (event.button !== 0) return
      if (dragStartRef.current || bezierDragStartRef.current) return

      event.preventDefault()

      const svg =
        event.currentTarget.ownerSVGElement ??
        (event.currentTarget instanceof SVGSVGElement ? event.currentTarget : null)
      if (!svg) return

      svg.setPointerCapture(event.pointerId)
      svgRef.current = svg

      const rect = svg.getBoundingClientRect()
      const startX = Math.max(0, Math.min(viewport.width, event.clientX - rect.left))
      const startY = Math.max(0, Math.min(viewport.height, event.clientY - rect.top))
      const mode: MarqueeMode = event.shiftKey
        ? 'add'
        : event.ctrlKey || event.metaKey
          ? 'toggle'
          : 'replace'

      marqueeStateRef.current = {
        pointerId: event.pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        mode,
        baseSelection: new Set(selectedKeyframeIds),
        started: false,
      }
      setMarqueeRect(null)
    },
    [
      disabled,
      selectedKeyframeIds,
      viewport.height,
      viewport.width,
      dragStartRef,
      bezierDragStartRef,
      svgRef,
    ],
  )

  return {
    marqueeRect,
    marqueeStateRef,
    marqueeJustEndedRef,
    handleBackgroundPointerDown,
  }
}
