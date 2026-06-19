/**
 * Graph curve component.
 * Renders interpolation curves between keyframes on the value graph.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { GraphKeyframePoint, GraphViewport, GraphPadding } from './types'
import type { EasingConfig } from '@/types/keyframe'
import { applyEasingConfig } from '../../utils/easing'
import { usePlaybackStore } from '@/shared/state/playback'
import { useCoalescedScrub } from '../use-coalesced-scrub'

interface GraphCurveProps {
  /** Start keyframe point */
  startPoint: GraphKeyframePoint
  /** End keyframe point */
  endPoint: GraphKeyframePoint
  /** Easing configuration for this segment */
  easingConfig?: EasingConfig
  /** Whether this segment is selected */
  isSelected?: boolean
  /** Stroke color override */
  strokeColor?: string
}

/** Number of sample points for curve */
const CURVE_SAMPLES = 50

/**
 * A single interpolation curve between two keyframes.
 */
const GraphCurve = memo(function GraphCurve({
  startPoint,
  endPoint,
  easingConfig,
  isSelected = false,
  strokeColor,
}: GraphCurveProps) {
  // Generate path by sampling the easing function
  const path = useMemo(() => {
    const points: string[] = []
    const config = easingConfig || { type: 'linear' as const }

    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES
      const easedT = applyEasingConfig(t, config)

      // Interpolate x linearly (time), y with easing (value)
      const x = startPoint.x + t * (endPoint.x - startPoint.x)
      const y = startPoint.y + easedT * (endPoint.y - startPoint.y)

      points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`)
    }

    return points.join(' ')
  }, [startPoint, endPoint, easingConfig])

  // Always use orange for curves (blue glow added when selected)
  const color = strokeColor || '#f97316'

  return (
    <g className="graph-curve" style={{ pointerEvents: 'none' }}>
      {/* Shadow/glow for selected curves */}
      {isSelected && (
        <path
          d={path}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={0.3}
        />
      )}
      {/* Main curve */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={1}
      />
    </g>
  )
})

/**
 * All curves for a set of keyframes.
 */
export const GraphCurves = memo(function GraphCurves({
  points,
  selectedKeyframeIds,
  previewBezierConfigs,
  strokeColor,
}: {
  points: GraphKeyframePoint[]
  selectedKeyframeIds?: Set<string>
  previewBezierConfigs?: Record<string, { x1: number; y1: number; x2: number; y2: number }> | null
  strokeColor?: string
}) {
  // Sort points by frame (toSorted for immutability)
  const sortedPoints = useMemo(
    () => points.toSorted((a, b) => a.keyframe.frame - b.keyframe.frame),
    [points],
  )

  if (sortedPoints.length < 2) return null

  return (
    <g className="graph-curves" style={{ pointerEvents: 'none' }}>
      {sortedPoints.slice(0, -1).map((startPoint, index) => {
        const endPoint = sortedPoints[index + 1]
        if (!endPoint) return null

        const isSelected =
          selectedKeyframeIds?.has(startPoint.keyframe.id) ||
          selectedKeyframeIds?.has(endPoint.keyframe.id)

        return (
          <GraphCurve
            key={`${startPoint.keyframe.id}-${endPoint.keyframe.id}`}
            startPoint={startPoint}
            endPoint={endPoint}
            easingConfig={
              previewBezierConfigs?.[startPoint.keyframe.id]
                ? {
                    type: 'cubic-bezier' as const,
                    bezier: previewBezierConfigs[startPoint.keyframe.id],
                  }
                : startPoint.keyframe.easingConfig || { type: startPoint.keyframe.easing }
            }
            isSelected={isSelected}
            strokeColor={strokeColor}
          />
        )
      })}
    </g>
  )
})

/**
 * Extension lines showing value beyond keyframe range.
 * Draws flat lines before first keyframe and after last keyframe.
 */
export const GraphExtensionLines = memo(function GraphExtensionLines({
  points,
  viewport,
  padding,
}: {
  points: GraphKeyframePoint[]
  viewport: GraphViewport
  padding: GraphPadding
}) {
  if (points.length === 0) return null

  // Sort points by frame (toSorted for immutability)
  const sortedPoints = points.toSorted((a, b) => a.keyframe.frame - b.keyframe.frame)
  const firstPoint = sortedPoints[0]
  const lastPoint = sortedPoints[sortedPoints.length - 1]

  if (!firstPoint || !lastPoint) return null

  const graphLeft = padding.left
  const graphRight = viewport.width - padding.right

  return (
    <g className="graph-extension-lines" style={{ pointerEvents: 'none' }}>
      {/* Line before first keyframe */}
      {firstPoint.x > graphLeft && (
        <line
          x1={graphLeft}
          y1={firstPoint.y}
          x2={firstPoint.x}
          y2={firstPoint.y}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          strokeOpacity={0.3}
        />
      )}
      {/* Line after last keyframe */}
      {lastPoint.x < graphRight && (
        <line
          x1={lastPoint.x}
          y1={lastPoint.y}
          x2={graphRight}
          y2={lastPoint.y}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          strokeOpacity={0.3}
        />
      )}
    </g>
  )
})

interface GraphPlayheadProps {
  frame: number
  /** Absolute timeline frame where the edited item starts (for live playback). */
  itemFrom?: number
  viewport: GraphViewport
  padding: GraphPadding
  /** Total frames in the clip (for display) */
  totalFrames?: number
  /** Timeline FPS used to scale scrub throttling by horizontal density */
  fps?: number
  /** Callback when playhead is scrubbed (dragged) */
  onScrub?: (frame: number) => void
  /** Callback when scrubbing starts */
  onScrubStart?: () => void
  /** Callback when scrubbing ends */
  onScrubEnd?: () => void
  /** Whether scrubbing is disabled */
  disabled?: boolean
  /** Whether to render the visible playhead line/marker */
  visuals?: 'visible' | 'hidden'
}

/**
 * Playhead indicator on the graph.
 * Shows current frame position as a vertical line with a triangular marker.
 * Can be dragged to scrub through frames.
 */
export const GraphPlayhead = memo(function GraphPlayhead({
  frame,
  itemFrom = 0,
  viewport,
  padding,
  totalFrames,
  fps = 30,
  onScrub,
  onScrubStart,
  onScrubEnd,
  disabled = false,
  visuals = 'visible',
}: GraphPlayheadProps) {
  const { startFrame, endFrame, width, height } = viewport

  const graphLeft = padding.left
  const graphTop = padding.top
  const graphWidth = width - padding.left - padding.right
  const graphHeight = height - padding.top - padding.bottom
  const frameRange = Math.max(1, endFrame - startFrame)
  const graphPixelsPerSecond = (graphWidth / frameRange) * fps

  // Clip-relative frame → clamped x in the graph's own coordinate space.
  const frameToGraphX = (relFrame: number): number => {
    const rawX = graphLeft + ((relFrame - startFrame) / frameRange) * graphWidth
    return Math.max(graphLeft, Math.min(graphLeft + graphWidth, rawX))
  }
  const x = frameToGraphX(frame)

  // The visuals are rendered at local x=0 inside a translated group so the
  // playhead can be moved during playback by writing the group transform via
  // ref — no React re-render of the graph (which is kept off the playback hot
  // path). During active editor scrubs the parent intentionally avoids pushing
  // every frame through React, so this group also follows the scrub store
  // directly. On settled seek/zoom the editor re-renders and the layout effect
  // below repositions from the `frame` prop.
  const groupRef = useRef<SVGGElement>(null)
  const {
    startScrub: startPlayheadScrub,
    queueScrub: queuePlayheadScrub,
    flushPendingScrub: flushPendingPlayheadScrub,
  } = useCoalescedScrub(onScrub)

  useLayoutEffect(() => {
    groupRef.current?.setAttribute('transform', `translate(${x}, 0)`)
  })

  useEffect(() => {
    const update = () => {
      const state = usePlaybackStore.getState()
      const isPreviewing = state.previewFrame !== null
      if (!state.isPlaying && !isPreviewing) return
      const lastFrame = totalFrames ? totalFrames - 1 : endFrame - 1
      const frame = state.previewFrame ?? state.currentFrame
      const rel = Math.max(0, Math.min(lastFrame, frame - itemFrom))
      groupRef.current?.setAttribute('transform', `translate(${frameToGraphX(rel)}, 0)`)
    }
    return usePlaybackStore.subscribe(update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFrom, totalFrames, startFrame, endFrame, graphLeft, graphWidth])

  // Convert screen X to frame (clamped to valid range)
  const screenXToFrame = (screenX: number): number => {
    const relativeX = screenX - graphLeft
    const normalizedX = Math.max(0, Math.min(1, relativeX / graphWidth))
    const calculatedFrame = Math.round(startFrame + normalizedX * frameRange)
    // Clamp to valid frame range [0, totalFrames - 1] (last valid frame is totalFrames - 1)
    // This prevents scrubbing past the clip boundary which would deselect the clip
    const maxValidFrame = totalFrames ? totalFrames - 1 : endFrame - 1
    return Math.max(0, Math.min(maxValidFrame, calculatedFrame))
  }

  // Handle pointer down on playhead
  const handlePointerDown = (event: React.PointerEvent) => {
    if (disabled || !onScrub) return

    event.preventDefault()
    event.stopPropagation()

    const svg = (event.target as SVGElement).ownerSVGElement
    if (!svg) return

    // Notify scrub start
    onScrubStart?.()

    // Capture pointer for drag
    svg.setPointerCapture(event.pointerId)
    let lastScrubbedFrame: number | null = null

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = svg.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const newFrame = screenXToFrame(localX)
      if (newFrame === lastScrubbedFrame) {
        return
      }
      lastScrubbedFrame = newFrame
      queuePlayheadScrub({
        frame: newFrame,
        pointerX: localX,
        pixelsPerSecond: graphPixelsPerSecond,
      })
    }

    // Also handles pointercancel — a system-interrupted gesture (capture lost,
    // touch cancelled) must clean up exactly like a normal release.
    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      svg.releasePointerCapture(event.pointerId)
      svg.removeEventListener('pointermove', handlePointerMove)
      svg.removeEventListener('pointerup', handlePointerUp)
      svg.removeEventListener('pointercancel', handlePointerUp)
      flushPendingPlayheadScrub(true)

      // Notify scrub end
      onScrubEnd?.()
    }

    svg.addEventListener('pointermove', handlePointerMove)
    svg.addEventListener('pointerup', handlePointerUp)
    svg.addEventListener('pointercancel', handlePointerUp)
    startPlayheadScrub({
      frame,
      pointerX: x,
      pixelsPerSecond: graphPixelsPerSecond,
    })
  }

  const isInteractive = !disabled && !!onScrub

  return (
    <g
      ref={groupRef}
      className="graph-playhead"
      style={{
        pointerEvents: isInteractive ? 'auto' : 'none',
        cursor: isInteractive ? 'ew-resize' : 'default',
      }}
    >
      {/* Invisible wider hit area for easier grabbing (local x=0; group is translated) */}
      {isInteractive && (
        <line
          x1={0}
          y1={graphTop}
          x2={0}
          y2={graphTop + graphHeight}
          stroke="transparent"
          strokeWidth={12}
          onPointerDown={handlePointerDown}
          style={{ cursor: 'ew-resize' }}
        />
      )}
      {visuals === 'visible' && (
        <>
          {/* Playhead line — orange, matching the dopesheet body line and the
              main timeline playhead; the flag handle is rendered once in the
              shared ruler. */}
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={graphTop + graphHeight}
            stroke="var(--color-timeline-playhead)"
            strokeWidth={1}
            onPointerDown={isInteractive ? handlePointerDown : undefined}
            style={{
              filter: 'drop-shadow(0 0 5px rgba(255, 140, 58, 0.65))',
              cursor: isInteractive ? 'ew-resize' : 'default',
            }}
          />
        </>
      )}
    </g>
  )
})
