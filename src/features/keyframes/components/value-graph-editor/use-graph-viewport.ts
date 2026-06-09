/**
 * Graph viewport hook.
 * Owns coordinate math, viewport clamping, focus-point selection,
 * and zoom controls (in/out/fit) for the value graph editor.
 *
 * Extracted from useGraphInteraction so the orchestrator hook can be
 * a thinner composition of independent interaction surfaces.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { GraphKeyframePoint, GraphPadding, GraphViewport } from './types'

export interface GraphDimensions {
  graphLeft: number
  graphTop: number
  graphWidth: number
  graphHeight: number
  frameRange: number
  valueRange: number
}

export function getGraphDimensions(
  viewport: GraphViewport,
  padding: GraphPadding,
): GraphDimensions {
  const graphLeft = padding.left
  const graphTop = padding.top
  const graphWidth = viewport.width - padding.left - padding.right
  const graphHeight = viewport.height - padding.top - padding.bottom
  const frameRange = viewport.endFrame - viewport.startFrame
  const valueRange = viewport.maxValue - viewport.minValue
  return { graphLeft, graphTop, graphWidth, graphHeight, frameRange, valueRange }
}

interface UseGraphViewportOptions {
  viewport: GraphViewport
  padding: GraphPadding
  points: GraphKeyframePoint[]
  selectedKeyframeIds: Set<string>
  maxFrame?: number
  /** Lower bound for the value axis (renamed internally to clampMinValue) */
  minValue?: number
  /** Upper bound for the value axis (renamed internally to clampMaxValue) */
  maxValue?: number
  onViewportChange?: (viewport: GraphViewport) => void
}

export interface UseGraphViewportReturn {
  graphDimensions: GraphDimensions
  zoomFocusPoint: { frame: number; value: number } | null
  clampViewportToBounds: (next: GraphViewport) => GraphViewport
  ensureKeyframesRemainVisible: (next: GraphViewport) => GraphViewport
  screenToGraph: (screenX: number, screenY: number) => { frame: number; value: number }
  zoomIn: () => void
  zoomOut: () => void
  fitToContent: () => void
}

export function useGraphViewport({
  viewport,
  padding,
  points,
  selectedKeyframeIds,
  maxFrame,
  minValue: clampMinValue,
  maxValue: clampMaxValue,
  onViewportChange,
}: UseGraphViewportOptions): UseGraphViewportReturn {
  // Stash callback in a ref so zoom controls stay stable
  const onViewportChangeRef = useRef(onViewportChange)
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  const graphDimensions = useMemo<GraphDimensions>(() => {
    return getGraphDimensions(viewport, padding)
  }, [viewport, padding])

  const zoomFocusPoint = useMemo(() => {
    const selectedPoints = points.filter((point) => selectedKeyframeIds.has(point.keyframe.id))
    const visiblePoints = points.filter(
      (point) =>
        point.keyframe.frame >= viewport.startFrame &&
        point.keyframe.frame <= viewport.endFrame &&
        point.keyframe.value >= viewport.minValue &&
        point.keyframe.value <= viewport.maxValue,
    )
    const focusPoints =
      selectedPoints.length > 0 ? selectedPoints : visiblePoints.length > 0 ? visiblePoints : points

    if (focusPoints.length === 0) return null

    const totals = focusPoints.reduce(
      (acc, point) => ({
        frame: acc.frame + point.keyframe.frame,
        value: acc.value + point.keyframe.value,
      }),
      { frame: 0, value: 0 },
    )

    return {
      frame: totals.frame / focusPoints.length,
      value: totals.value / focusPoints.length,
    }
  }, [
    points,
    selectedKeyframeIds,
    viewport.startFrame,
    viewport.endFrame,
    viewport.minValue,
    viewport.maxValue,
  ])

  const clampViewportToBounds = useCallback(
    (nextViewport: GraphViewport): GraphViewport => {
      let startFrame = nextViewport.startFrame
      let endFrame = nextViewport.endFrame
      let minValue = nextViewport.minValue
      let maxValue = nextViewport.maxValue

      const frameRange = Math.max(1, endFrame - startFrame)
      const maxFrameExtent = Math.max(maxFrame ?? 0, frameRange)

      if (startFrame < 0) {
        endFrame -= startFrame
        startFrame = 0
      }
      if (endFrame > maxFrameExtent) {
        const overflow = endFrame - maxFrameExtent
        startFrame = Math.max(0, startFrame - overflow)
        endFrame = maxFrameExtent
      }

      const valueRange = Math.max(0.0001, maxValue - minValue)
      if (clampMinValue !== undefined && clampMaxValue !== undefined) {
        const totalRange = Math.max(0.0001, clampMaxValue - clampMinValue)
        const boundedRange = Math.min(valueRange, totalRange)
        minValue = Math.max(clampMinValue, Math.min(clampMaxValue - boundedRange, minValue))
        maxValue = minValue + boundedRange
      } else {
        if (clampMinValue !== undefined && minValue < clampMinValue) {
          maxValue += clampMinValue - minValue
          minValue = clampMinValue
        }
        if (clampMaxValue !== undefined && maxValue > clampMaxValue) {
          minValue -= maxValue - clampMaxValue
          maxValue = clampMaxValue
        }
      }

      return {
        ...nextViewport,
        startFrame,
        endFrame,
        minValue,
        maxValue,
      }
    },
    [maxFrame, clampMinValue, clampMaxValue],
  )

  const ensureKeyframesRemainVisible = useCallback(
    (nextViewport: GraphViewport): GraphViewport => {
      const clampedViewport = clampViewportToBounds(nextViewport)
      if (points.length === 0 || !zoomFocusPoint) {
        return clampedViewport
      }

      const hasVisiblePoint = points.some(
        (point) =>
          point.keyframe.frame >= clampedViewport.startFrame &&
          point.keyframe.frame <= clampedViewport.endFrame &&
          point.keyframe.value >= clampedViewport.minValue &&
          point.keyframe.value <= clampedViewport.maxValue,
      )

      if (hasVisiblePoint) {
        return clampedViewport
      }

      const frameRange = Math.max(1, clampedViewport.endFrame - clampedViewport.startFrame)
      const valueRange = Math.max(0.0001, clampedViewport.maxValue - clampedViewport.minValue)

      return clampViewportToBounds({
        ...clampedViewport,
        startFrame: zoomFocusPoint.frame - frameRange / 2,
        endFrame: zoomFocusPoint.frame + frameRange / 2,
        minValue: zoomFocusPoint.value - valueRange / 2,
        maxValue: zoomFocusPoint.value + valueRange / 2,
      })
    },
    [clampViewportToBounds, points, zoomFocusPoint],
  )

  const screenToGraph = useCallback(
    (screenX: number, screenY: number): { frame: number; value: number } => {
      const { graphLeft, graphTop, graphWidth, graphHeight, frameRange, valueRange } =
        graphDimensions
      const frame = viewport.startFrame + ((screenX - graphLeft) / graphWidth) * frameRange
      const value = viewport.maxValue - ((screenY - graphTop) / graphHeight) * valueRange
      return { frame, value }
    },
    [viewport, graphDimensions],
  )

  const zoomIn = useCallback(() => {
    const { frameRange, valueRange } = graphDimensions
    const centerFrame = zoomFocusPoint?.frame ?? (viewport.startFrame + viewport.endFrame) / 2
    const centerValue = zoomFocusPoint?.value ?? (viewport.minValue + viewport.maxValue) / 2
    const newFrameRange = frameRange * 0.8
    const newValueRange = valueRange * 0.8

    onViewportChangeRef.current?.(
      ensureKeyframesRemainVisible({
        ...viewport,
        startFrame: centerFrame - newFrameRange / 2,
        endFrame: centerFrame + newFrameRange / 2,
        minValue: centerValue - newValueRange / 2,
        maxValue: centerValue + newValueRange / 2,
      }),
    )
  }, [viewport, graphDimensions, zoomFocusPoint, ensureKeyframesRemainVisible])

  const zoomOut = useCallback(() => {
    const { frameRange, valueRange } = graphDimensions
    const centerFrame = zoomFocusPoint?.frame ?? (viewport.startFrame + viewport.endFrame) / 2
    const centerValue = zoomFocusPoint?.value ?? (viewport.minValue + viewport.maxValue) / 2
    const newFrameRange = frameRange * 1.25
    const newValueRange = valueRange * 1.25

    onViewportChangeRef.current?.(
      ensureKeyframesRemainVisible({
        ...viewport,
        startFrame: centerFrame - newFrameRange / 2,
        endFrame: centerFrame + newFrameRange / 2,
        minValue: centerValue - newValueRange / 2,
        maxValue: centerValue + newValueRange / 2,
      }),
    )
  }, [viewport, graphDimensions, zoomFocusPoint, ensureKeyframesRemainVisible])

  const fitToContent = useCallback(() => {
    onViewportChangeRef.current?.(
      clampViewportToBounds({
        ...viewport,
        startFrame: 0,
        endFrame: Math.max(maxFrame ?? 60, 60),
        minValue: clampMinValue ?? 0,
        maxValue: clampMaxValue ?? 1,
      }),
    )
  }, [viewport, maxFrame, clampMinValue, clampMaxValue, clampViewportToBounds])

  return {
    graphDimensions,
    zoomFocusPoint,
    clampViewportToBounds,
    ensureKeyframesRemainVisible,
    screenToGraph,
    zoomIn,
    zoomOut,
    fitToContent,
  }
}
