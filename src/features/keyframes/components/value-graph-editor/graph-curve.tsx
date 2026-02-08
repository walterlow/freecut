/**
 * Graph curve component.
 * Renders interpolation curves between keyframes on the value graph.
 */

import { memo, useMemo } from 'react';
import type { GraphKeyframePoint, GraphViewport, GraphPadding } from './types';
import type { EasingConfig } from '@/types/keyframe';
import { applyEasingConfig } from '../../utils/easing';

interface GraphCurveProps {
  /** Start keyframe point */
  startPoint: GraphKeyframePoint;
  /** End keyframe point */
  endPoint: GraphKeyframePoint;
  /** Easing configuration for this segment */
  easingConfig?: EasingConfig;
  /** Whether this segment is selected */
  isSelected?: boolean;
  /** Stroke color override */
  strokeColor?: string;
}

/** Number of sample points for curve */
const CURVE_SAMPLES = 50;

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
    const points: string[] = [];
    const config = easingConfig || { type: 'linear' as const };

    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES;
      const easedT = applyEasingConfig(t, config);

      // Interpolate x linearly (time), y with easing (value)
      const x = startPoint.x + t * (endPoint.x - startPoint.x);
      const y = startPoint.y + easedT * (endPoint.y - startPoint.y);

      points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
    }

    return points.join(' ');
  }, [startPoint, endPoint, easingConfig]);

  // Always use orange for curves (blue glow added when selected)
  const color = strokeColor || '#f97316';

  return (
    <g className="graph-curve">
      {/* Shadow/glow for selected curves */}
      {isSelected && (
        <path
          d={path}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={6}
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
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={1}
      />
    </g>
  );
});

/**
 * All curves for a set of keyframes.
 */
export const GraphCurves = memo(function GraphCurves({
  points,
  selectedKeyframeIds,
}: {
  points: GraphKeyframePoint[];
  selectedKeyframeIds?: Set<string>;
}) {
  // Sort points by frame (toSorted for immutability)
  const sortedPoints = useMemo(
    () => points.toSorted((a, b) => a.keyframe.frame - b.keyframe.frame),
    [points]
  );

  if (sortedPoints.length < 2) return null;

  return (
    <g className="graph-curves">
      {sortedPoints.slice(0, -1).map((startPoint, index) => {
        const endPoint = sortedPoints[index + 1];
        if (!endPoint) return null;

        const isSelected =
          selectedKeyframeIds?.has(startPoint.keyframe.id) ||
          selectedKeyframeIds?.has(endPoint.keyframe.id);

        return (
          <GraphCurve
            key={`${startPoint.keyframe.id}-${endPoint.keyframe.id}`}
            startPoint={startPoint}
            endPoint={endPoint}
            easingConfig={startPoint.keyframe.easingConfig || { type: startPoint.keyframe.easing }}
            isSelected={isSelected}
          />
        );
      })}
    </g>
  );
});

/**
 * Extension lines showing value beyond keyframe range.
 * Draws flat lines before first keyframe and after last keyframe.
 */
export const GraphExtensionLines = memo(function GraphExtensionLines({
  points,
  viewport,
  padding,
}: {
  points: GraphKeyframePoint[];
  viewport: GraphViewport;
  padding: GraphPadding;
}) {
  if (points.length === 0) return null;

  // Sort points by frame (toSorted for immutability)
  const sortedPoints = points.toSorted((a, b) => a.keyframe.frame - b.keyframe.frame);
  const firstPoint = sortedPoints[0];
  const lastPoint = sortedPoints[sortedPoints.length - 1];

  if (!firstPoint || !lastPoint) return null;

  const graphLeft = padding.left;
  const graphRight = viewport.width - padding.right;

  return (
    <g className="graph-extension-lines">
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
  );
});

interface GraphPlayheadProps {
  frame: number;
  viewport: GraphViewport;
  padding: GraphPadding;
  /** Total frames in the clip (for display) */
  totalFrames?: number;
  /** Callback when playhead is scrubbed (dragged) */
  onScrub?: (frame: number) => void;
  /** Callback when scrubbing starts */
  onScrubStart?: () => void;
  /** Callback when scrubbing ends */
  onScrubEnd?: () => void;
  /** Whether scrubbing is disabled */
  disabled?: boolean;
}

/**
 * Playhead indicator on the graph.
 * Shows current frame position as a vertical line with a triangular marker.
 * Can be dragged to scrub through frames.
 */
export const GraphPlayhead = memo(function GraphPlayhead({
  frame,
  viewport,
  padding,
  totalFrames,
  onScrub,
  onScrubStart,
  onScrubEnd,
  disabled = false,
}: GraphPlayheadProps) {
  const { startFrame, endFrame, width, height } = viewport;

  // Check if playhead is in visible range
  if (frame < startFrame || frame > endFrame) return null;

  const graphLeft = padding.left;
  const graphTop = padding.top;
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  const x = graphLeft + ((frame - startFrame) / (endFrame - startFrame)) * graphWidth;

  // Convert screen X to frame (clamped to valid range)
  const screenXToFrame = (screenX: number): number => {
    const relativeX = screenX - graphLeft;
    const normalizedX = Math.max(0, Math.min(1, relativeX / graphWidth));
    const calculatedFrame = Math.round(startFrame + normalizedX * (endFrame - startFrame));
    // Clamp to valid frame range [0, totalFrames - 1] (last valid frame is totalFrames - 1)
    // This prevents scrubbing past the clip boundary which would deselect the clip
    const maxValidFrame = totalFrames ? totalFrames - 1 : endFrame - 1;
    return Math.max(0, Math.min(maxValidFrame, calculatedFrame));
  };

  // Handle pointer down on playhead
  const handlePointerDown = (event: React.PointerEvent) => {
    if (disabled || !onScrub) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    const svg = (event.target as SVGElement).ownerSVGElement;
    if (!svg) return;

    // Notify scrub start
    onScrubStart?.();

    // Capture pointer for drag
    svg.setPointerCapture(event.pointerId);

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = svg.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const newFrame = screenXToFrame(localX);
      onScrub(newFrame);
    };

    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      svg.releasePointerCapture(event.pointerId);
      svg.removeEventListener('pointermove', handlePointerMove);
      svg.removeEventListener('pointerup', handlePointerUp);
      
      // Notify scrub end
      onScrubEnd?.();
    };

    svg.addEventListener('pointermove', handlePointerMove);
    svg.addEventListener('pointerup', handlePointerUp);
  };

  const isInteractive = !disabled && !!onScrub;

  return (
    <g 
      className="graph-playhead" 
      style={{ 
        pointerEvents: isInteractive ? 'auto' : 'none',
        cursor: isInteractive ? 'ew-resize' : 'default',
      }}
    >
      {/* Invisible wider hit area for easier grabbing */}
      {isInteractive && (
        <line
          x1={x}
          y1={graphTop}
          x2={x}
          y2={graphTop + graphHeight}
          stroke="transparent"
          strokeWidth={12}
          onPointerDown={handlePointerDown}
          style={{ cursor: 'ew-resize' }}
        />
      )}
      {/* Visible playhead line */}
      <line
        x1={x}
        y1={graphTop}
        x2={x}
        y2={graphTop + graphHeight}
        stroke="#ef4444"
        strokeWidth={2}
        strokeOpacity={0.9}
        onPointerDown={isInteractive ? handlePointerDown : undefined}
        style={{ cursor: isInteractive ? 'ew-resize' : 'default' }}
      />
      {/* Playhead top marker (draggable handle) */}
      <path
        d={`M ${x - 6} ${graphTop} L ${x + 6} ${graphTop} L ${x} ${graphTop + 8} Z`}
        fill="#ef4444"
        onPointerDown={isInteractive ? handlePointerDown : undefined}
        style={{ cursor: isInteractive ? 'ew-resize' : 'default' }}
      />
      {/* Frame number label */}
      <text
        x={x}
        y={graphTop - 4}
        textAnchor="middle"
        fill="#ef4444"
        fontSize={9}
        fontFamily="monospace"
        fontWeight="bold"
        style={{ pointerEvents: 'none' }}
      >
        {totalFrames ? `F${Math.round(frame)}/${totalFrames - 1}` : `F${Math.round(frame)}`}
      </text>
    </g>
  );
});
