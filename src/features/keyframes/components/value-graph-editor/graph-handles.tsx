/**
 * Graph bezier handles component.
 * Renders draggable bezier control point handles for cubic-bezier keyframes.
 */

import { memo, useMemo, useCallback } from 'react'
import { cn } from '@/shared/ui/cn'
import { getBezierPresetForEasing } from '@/features/keyframes/utils/easing-presets'
import type { BezierControlPoints } from '@/types/keyframe'
import type { GraphKeyframePoint, GraphBezierHandle } from './types'

const MIN_VISIBLE_HANDLE_DISTANCE = 2

interface GraphHandlesProps {
  /** All keyframe points */
  points: GraphKeyframePoint[]
  /** Selected keyframe IDs (only show handles for selected keyframes) */
  selectedKeyframeIds: Set<string>
  /** Callback when handle pointer down (starts drag) */
  onHandlePointerDown?: (handle: GraphBezierHandle, event: React.PointerEvent) => void
  /** Currently dragging handle (for visual feedback) */
  draggingHandle?: { keyframeId: string; type: 'in' | 'out' } | null
  /** Preview bezier configs during drag (overrides keyframe data for lag-free rendering) */
  previewBezierConfigs?: Record<string, BezierControlPoints> | null
  /** Whether handles for all visible segments should be shown */
  showAllHandles?: boolean
  /** Whether the graph is disabled */
  disabled?: boolean
}

/**
 * Renders bezier handles for selected keyframes with cubic-bezier easing.
 */
export const GraphHandles = memo(function GraphHandles({
  points,
  selectedKeyframeIds,
  onHandlePointerDown,
  draggingHandle,
  previewBezierConfigs,
  showAllHandles = false,
  disabled = false,
}: GraphHandlesProps) {
  // Sort points by frame (toSorted for immutability)
  const sortedPoints = useMemo(
    () => points.toSorted((a, b) => a.keyframe.frame - b.keyframe.frame),
    [points],
  )

  // Generate handles for selected keyframes with cubic-bezier easing
  const handles = useMemo(() => {
    const result: GraphBezierHandle[] = []

    sortedPoints.forEach((point, index) => {
      const nextPoint = sortedPoints[index + 1]
      if (!nextPoint) return

      const startSelected = selectedKeyframeIds.has(point.keyframe.id)
      const endSelected = selectedKeyframeIds.has(nextPoint.keyframe.id)

      if (!showAllHandles && !startSelected && !endSelected) {
        return
      }

      // Use preview bezier config if available (during drag), otherwise use keyframe data
      const previewBezier = previewBezierConfigs?.[point.keyframe.id]
      const config = point.keyframe.easingConfig
      const bezier =
        previewBezier ??
        (config?.type === 'cubic-bezier'
          ? config.bezier
          : getBezierPresetForEasing(point.keyframe.easing))
      if (!bezier) return

      // Calculate the curve segment dimensions
      const segmentWidth = nextPoint.x - point.x
      const segmentHeight = nextPoint.y - point.y

      // Determine which handles to show based on easing type
      const easing = point.keyframe.easing
      const showOut = easing !== 'ease-out' // ease-in and ease-in-out show the out handle
      const showIn = easing !== 'ease-in' // ease-out and ease-in-out show the in handle

      // Control point 1 (outgoing, anchored at startPoint) — only show if startPoint is selected
      if (showOut && (showAllHandles || startSelected)) {
        const cp1X = point.x + bezier.x1 * segmentWidth
        const cp1Y = point.y + bezier.y1 * segmentHeight

        if (Math.hypot(cp1X - point.x, cp1Y - point.y) > MIN_VISIBLE_HANDLE_DISTANCE) {
          result.push({
            keyframeId: point.keyframe.id,
            type: 'out',
            x: cp1X,
            y: cp1Y,
            anchorX: point.x,
            anchorY: point.y,
          })
        }
      }

      // Control point 2 (incoming, anchored at endPoint) — only show if endPoint is selected
      if (showIn && (showAllHandles || endSelected)) {
        const cp2X = point.x + bezier.x2 * segmentWidth
        const cp2Y = point.y + bezier.y2 * segmentHeight

        if (Math.hypot(cp2X - nextPoint.x, cp2Y - nextPoint.y) > MIN_VISIBLE_HANDLE_DISTANCE) {
          result.push({
            keyframeId: point.keyframe.id,
            type: 'in',
            x: cp2X,
            y: cp2Y,
            anchorX: nextPoint.x,
            anchorY: nextPoint.y,
          })
        }
      }
    })

    return result
  }, [showAllHandles, sortedPoints, selectedKeyframeIds, previewBezierConfigs])

  if (handles.length === 0) return null

  return (
    <g className="graph-handles">
      {handles.map((handle) => (
        <BezierHandle
          key={`${handle.keyframeId}-${handle.type}`}
          handle={handle}
          isDragging={
            draggingHandle?.keyframeId === handle.keyframeId && draggingHandle?.type === handle.type
          }
          onPointerDown={onHandlePointerDown}
          disabled={disabled}
        />
      ))}
    </g>
  )
})

interface BezierHandleProps {
  handle: GraphBezierHandle
  isDragging: boolean
  onPointerDown?: (handle: GraphBezierHandle, event: React.PointerEvent) => void
  disabled: boolean
}

/**
 * Single bezier control point handle.
 * Uses pointer events for reliable drag behavior.
 */
const BezierHandle = memo(function BezierHandle({
  handle,
  isDragging,
  onPointerDown,
  disabled,
}: BezierHandleProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      // Don't prevent default - let the hook handle pointer capture
      onPointerDown?.(handle, e)
    },
    [disabled, onPointerDown, handle],
  )

  return (
    <g className="bezier-handle" style={{ touchAction: 'none' }}>
      {/* Line from anchor to handle */}
      <line
        x1={handle.anchorX}
        y1={handle.anchorY}
        x2={handle.x}
        y2={handle.y}
        stroke="#e5e7eb"
        strokeWidth={1}
        strokeOpacity={0.8}
        style={{ pointerEvents: 'none' }}
      />

      {/* Handle circle - larger hit area */}
      <circle
        cx={handle.x}
        cy={handle.y}
        r={12}
        fill="transparent"
        onPointerDown={handlePointerDown}
        className={cn(!disabled && 'cursor-grab', isDragging && 'cursor-grabbing')}
        style={{ touchAction: 'none' }}
      />

      {/* Handle circle - visual */}
      <circle
        cx={handle.x}
        cy={handle.y}
        r={5}
        fill={isDragging ? '#f8fafc' : '#d1d5db'}
        stroke="#111827"
        strokeWidth={1.25}
        className={cn(
          'transition-colors',
          !disabled && 'hover:fill-[#f3f4f6]',
          isDragging && 'r-[6]',
        )}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  )
})
