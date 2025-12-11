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
export const GraphCurve = memo(function GraphCurve({
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

  const color = strokeColor || (isSelected ? 'hsl(var(--primary))' : '#f97316');

  return (
    <g className="graph-curve">
      {/* Shadow/glow for selected curves */}
      {isSelected && (
        <path
          d={path}
          fill="none"
          stroke="hsl(var(--primary))"
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
  // Sort points by frame
  const sortedPoints = useMemo(
    () => [...points].sort((a, b) => a.keyframe.frame - b.keyframe.frame),
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

  // Sort points by frame
  const sortedPoints = [...points].sort((a, b) => a.keyframe.frame - b.keyframe.frame);
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

/**
 * Playhead indicator on the graph.
 */
export const GraphPlayhead = memo(function GraphPlayhead({
  frame,
  viewport,
  padding,
}: {
  frame: number;
  viewport: GraphViewport;
  padding: GraphPadding;
}) {
  const { startFrame, endFrame, width, height } = viewport;

  // Check if playhead is in visible range
  if (frame < startFrame || frame > endFrame) return null;

  const graphLeft = padding.left;
  const graphTop = padding.top;
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  const x = graphLeft + ((frame - startFrame) / (endFrame - startFrame)) * graphWidth;

  return (
    <g className="graph-playhead">
      <line
        x1={x}
        y1={graphTop}
        x2={x}
        y2={graphTop + graphHeight}
        stroke="hsl(var(--destructive))"
        strokeWidth={2}
        strokeOpacity={0.8}
      />
      {/* Playhead top marker */}
      <path
        d={`M ${x - 6} ${graphTop} L ${x + 6} ${graphTop} L ${x} ${graphTop + 8} Z`}
        fill="hsl(var(--destructive))"
      />
    </g>
  );
});
