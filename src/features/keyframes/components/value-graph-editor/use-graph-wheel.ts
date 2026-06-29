/**
 * Graph wheel hook. Standard scroll model:
 * - Ctrl/Cmd+wheel zooms the time axis about the mouse.
 * - Shift+wheel / trackpad horizontal swipe pans the time axis.
 * - Plain wheel pans the value (vertical) axis.
 * Gates against active drags via shared refs so the wheel does not interrupt a
 * pointer drag in flight.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { GraphViewport } from './types'
import {
  FRAME_ZOOM_IN_FACTOR,
  FRAME_ZOOM_OUT_FACTOR,
  type BezierDragStartState,
  type DragStartState,
} from './graph-interaction-types'

interface GraphDimensionsSlice {
  graphWidth: number
  graphHeight: number
  frameRange: number
  valueRange: number
}

interface UseGraphWheelOptions {
  disabled: boolean
  viewport: GraphViewport
  graphDimensions: GraphDimensionsSlice
  screenToGraph: (screenX: number, screenY: number) => { frame: number; value: number }
  clampViewportToBounds: (next: GraphViewport) => GraphViewport
  ensureKeyframesRemainVisible: (next: GraphViewport) => GraphViewport
  dragStartRef: React.RefObject<DragStartState | null>
  bezierDragStartRef: React.RefObject<BezierDragStartState | null>
  onViewportChange?: (viewport: GraphViewport) => void
}

export interface UseGraphWheelReturn {
  handleWheel: (event: React.WheelEvent) => void
}

export function useGraphWheel({
  disabled,
  viewport,
  graphDimensions,
  screenToGraph,
  clampViewportToBounds,
  ensureKeyframesRemainVisible,
  dragStartRef,
  bezierDragStartRef,
  onViewportChange,
}: UseGraphWheelOptions): UseGraphWheelReturn {
  const onViewportChangeRef = useRef(onViewportChange)
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (disabled) return
      // Don't zoom/pan while dragging a keyframe or bezier handle
      if (dragStartRef.current || bezierDragStartRef.current) return

      event.preventDefault()

      const rect = event.currentTarget.getBoundingClientRect()
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top

      const { frameRange, graphWidth, graphHeight, valueRange } = graphDimensions
      const { frame: mouseFrame } = screenToGraph(mouseX, mouseY)

      // Ctrl/Cmd → zoom the time axis about the cursor.
      if (event.ctrlKey || event.metaKey) {
        const zoomFactor = event.deltaY > 0 ? FRAME_ZOOM_OUT_FACTOR : FRAME_ZOOM_IN_FACTOR
        const newFrameRange = frameRange * zoomFactor
        const frameRatioBefore = (mouseFrame - viewport.startFrame) / frameRange
        const unclampedStartFrame = mouseFrame - newFrameRange * frameRatioBefore
        const nextViewport = ensureKeyframesRemainVisible({
          ...viewport,
          startFrame: Math.max(0, unclampedStartFrame),
          endFrame: Math.max(0, unclampedStartFrame) + newFrameRange,
          minValue: viewport.minValue,
          maxValue: viewport.maxValue,
        })

        onViewportChangeRef.current?.({
          ...nextViewport,
          minValue: viewport.minValue,
          maxValue: viewport.maxValue,
        })
        return
      }

      // Shift / trackpad horizontal swipe → pan the time axis.
      const horizontalDelta =
        event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
      if (horizontalDelta !== 0) {
        const deltaFrames = Math.round((horizontalDelta / Math.max(1, graphWidth)) * frameRange)
        onViewportChangeRef.current?.(
          clampViewportToBounds({
            ...viewport,
            startFrame: viewport.startFrame + deltaFrames,
            endFrame: viewport.endFrame + deltaFrames,
          }),
        )
        return
      }

      // Plain wheel → pan the value (vertical) axis. A no-op when the value axis
      // is fully fit; meaningful once it's zoomed via the vertical-zoom control.
      const deltaValue = (event.deltaY / Math.max(1, graphHeight)) * valueRange
      onViewportChangeRef.current?.(
        clampViewportToBounds({
          ...viewport,
          minValue: viewport.minValue - deltaValue,
          maxValue: viewport.maxValue - deltaValue,
        }),
      )
    },
    [
      disabled,
      viewport,
      screenToGraph,
      graphDimensions,
      ensureKeyframesRemainVisible,
      clampViewportToBounds,
      dragStartRef,
      bezierDragStartRef,
    ],
  )

  return { handleWheel }
}
