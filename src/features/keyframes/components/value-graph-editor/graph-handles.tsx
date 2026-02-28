/**
 * Graph bezier handles component.
 * Renders draggable bezier control point handles for cubic-bezier keyframes.
 */

import { memo, useMemo, useCallback } from 'react';
import { cn } from '@/shared/ui/cn';
import type { GraphKeyframePoint, GraphBezierHandle } from './types';

interface GraphHandlesProps {
  /** All keyframe points */
  points: GraphKeyframePoint[];
  /** Selected keyframe IDs (only show handles for selected keyframes) */
  selectedKeyframeIds: Set<string>;
  /** Callback when handle pointer down (starts drag) */
  onHandlePointerDown?: (handle: GraphBezierHandle, event: React.PointerEvent) => void;
  /** Currently dragging handle (for visual feedback) */
  draggingHandle?: { keyframeId: string; type: 'in' | 'out' } | null;
  /** Whether the graph is disabled */
  disabled?: boolean;
}

/**
 * Renders bezier handles for selected keyframes with cubic-bezier easing.
 */
export const GraphHandles = memo(function GraphHandles({
  points,
  selectedKeyframeIds,
  onHandlePointerDown,
  draggingHandle,
  disabled = false,
}: GraphHandlesProps) {
  // Sort points by frame (toSorted for immutability)
  const sortedPoints = useMemo(
    () => points.toSorted((a, b) => a.keyframe.frame - b.keyframe.frame),
    [points]
  );

  // Generate handles for selected keyframes with cubic-bezier easing
  const handles = useMemo(() => {
    const result: GraphBezierHandle[] = [];

    sortedPoints.forEach((point, index) => {
      if (!selectedKeyframeIds.has(point.keyframe.id)) return;

      const config = point.keyframe.easingConfig;
      if (config?.type !== 'cubic-bezier' || !config.bezier) return;

      const nextPoint = sortedPoints[index + 1];
      if (!nextPoint) return;

      // Calculate the curve segment dimensions
      const segmentWidth = nextPoint.x - point.x;
      const segmentHeight = nextPoint.y - point.y;

      // Control point 1 (outgoing from current keyframe)
      const cp1X = point.x + config.bezier.x1 * segmentWidth;
      const cp1Y = point.y + config.bezier.y1 * segmentHeight;

      result.push({
        keyframeId: point.keyframe.id,
        type: 'out',
        x: cp1X,
        y: cp1Y,
        anchorX: point.x,
        anchorY: point.y,
      });

      // Control point 2 (incoming to next keyframe)
      const cp2X = point.x + config.bezier.x2 * segmentWidth;
      const cp2Y = point.y + config.bezier.y2 * segmentHeight;

      result.push({
        keyframeId: point.keyframe.id,
        type: 'in',
        x: cp2X,
        y: cp2Y,
        anchorX: nextPoint.x,
        anchorY: nextPoint.y,
      });
    });

    return result;
  }, [sortedPoints, selectedKeyframeIds]);

  if (handles.length === 0) return null;

  return (
    <g className="graph-handles">
      {handles.map((handle) => (
        <BezierHandle
          key={`${handle.keyframeId}-${handle.type}`}
          handle={handle}
          isDragging={
            draggingHandle?.keyframeId === handle.keyframeId &&
            draggingHandle?.type === handle.type
          }
          onPointerDown={onHandlePointerDown}
          disabled={disabled}
        />
      ))}
    </g>
  );
});

interface BezierHandleProps {
  handle: GraphBezierHandle;
  isDragging: boolean;
  onPointerDown?: (handle: GraphBezierHandle, event: React.PointerEvent) => void;
  disabled: boolean;
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
      if (disabled) return;
      // Don't prevent default - let the hook handle pointer capture
      onPointerDown?.(handle, e);
    },
    [disabled, onPointerDown, handle]
  );

  return (
    <g className="bezier-handle" style={{ touchAction: 'none' }}>
      {/* Line from anchor to handle */}
      <line
        x1={handle.anchorX}
        y1={handle.anchorY}
        x2={handle.x}
        y2={handle.y}
        stroke="hsl(var(--primary))"
        strokeWidth={1}
        strokeOpacity={0.6}
        strokeDasharray="3 2"
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
        fill={isDragging ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
        stroke="hsl(var(--primary))"
        strokeWidth={2}
        className={cn(
          'transition-all',
          !disabled && 'hover:fill-[hsl(var(--primary))]',
          isDragging && 'r-[6]'
        )}
        style={{ pointerEvents: 'none' }}
      />

      {/* Handle type indicator */}
      <text
        x={handle.x + (handle.type === 'out' ? 10 : -10)}
        y={handle.y - 10}
        textAnchor={handle.type === 'out' ? 'start' : 'end'}
        fill="hsl(var(--primary))"
        fontSize={9}
        fontFamily="monospace"
        fillOpacity={0.7}
        style={{ pointerEvents: 'none' }}
      >
        {handle.type === 'out' ? 'P1' : 'P2'}
      </text>
    </g>
  );
});

