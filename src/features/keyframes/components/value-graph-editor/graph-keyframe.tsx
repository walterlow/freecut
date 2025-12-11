/**
 * Graph keyframe point component.
 * Renders a draggable keyframe point on the value graph.
 * Uses pointer events for reliable drag behavior with pointer capture.
 */

import { memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { GraphKeyframePoint } from './types';

interface GraphKeyframeProps {
  /** Keyframe point data */
  point: GraphKeyframePoint;
  /** Size of the point in pixels */
  size?: number;
  /** Preview values during drag (frame and value the keyframe will move to) */
  previewValues?: { frame: number; value: number } | null;
  /** Callback when pointer down on point (starts drag) */
  onPointerDown?: (point: GraphKeyframePoint, event: React.PointerEvent) => void;
  /** Callback when point is clicked (selection only, no drag) */
  onClick?: (point: GraphKeyframePoint, event: React.MouseEvent) => void;
  /** Callback when point is double-clicked */
  onDoubleClick?: (point: GraphKeyframePoint, event: React.MouseEvent) => void;
  /** Whether the graph is disabled */
  disabled?: boolean;
}

/**
 * A single keyframe point on the graph.
 * Uses pointer events with pointer capture for reliable dragging.
 */
export const GraphKeyframe = memo(function GraphKeyframe({
  point,
  size = 10,
  previewValues,
  onPointerDown,
  onClick,
  onDoubleClick,
  disabled = false,
}: GraphKeyframeProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      // Don't prevent default here - let the hook handle pointer capture
      onPointerDown?.(point, e);
    },
    [disabled, onPointerDown, point]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.stopPropagation();
      onClick?.(point, e);
    },
    [disabled, onClick, point]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.stopPropagation();
      onDoubleClick?.(point, e);
    },
    [disabled, onDoubleClick, point]
  );

  const halfSize = size / 2;

  // Use preview values when dragging, otherwise use current keyframe values
  const displayFrame = point.isDragging && previewValues ? previewValues.frame : point.keyframe.frame;
  const displayValue = point.isDragging && previewValues ? previewValues.value : point.keyframe.value;

  return (
    <g
      className={cn(
        'graph-keyframe',
        !disabled && 'cursor-grab',
        point.isDragging && 'cursor-grabbing'
      )}
      style={{ touchAction: 'none' }}
    >
      {/* Hit area (larger invisible target) - uses pointer events */}
      <circle
        cx={point.x}
        cy={point.y}
        r={size}
        fill="transparent"
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
      />

      {/* Selection ring */}
      {point.isSelected && (
        <circle
          cx={point.x}
          cy={point.y}
          r={halfSize + 4}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          strokeOpacity={0.5}
        />
      )}

      {/* Diamond shape */}
      <path
        d={`
          M ${point.x} ${point.y - halfSize}
          L ${point.x + halfSize} ${point.y}
          L ${point.x} ${point.y + halfSize}
          L ${point.x - halfSize} ${point.y}
          Z
        `}
        fill={point.isSelected ? 'hsl(var(--primary))' : '#f97316'}
        stroke="hsl(var(--background))"
        strokeWidth={2}
        className={cn(
          'transition-colors',
          !disabled && 'hover:fill-[hsl(var(--primary))]',
          point.isDragging && 'fill-[hsl(var(--primary))]'
        )}
        style={{ pointerEvents: 'none' }}
      />

      {/* Value tooltip when dragging - shows TARGET values */}
      {point.isDragging && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={point.x + 12}
            y={point.y - 24}
            width={90}
            height={20}
            rx={4}
            fill="#1c1c1c"
            stroke="#3a3a3a"
            strokeWidth={1}
          />
          <text
            x={point.x + 57}
            y={point.y - 10}
            textAnchor="middle"
            fill="#e5e5e5"
            fontSize={11}
            fontFamily="monospace"
          >
            {`F${displayFrame} → ${formatKeyframeValue(displayValue)}`}
          </text>
        </g>
      )}
    </g>
  );
});

/**
 * Batch of keyframe points (optimized rendering).
 */
export const GraphKeyframes = memo(function GraphKeyframes({
  points,
  size = 10,
  previewValues,
  onPointerDown,
  onClick,
  onDoubleClick,
  disabled = false,
}: {
  points: GraphKeyframePoint[];
  size?: number;
  previewValues?: { frame: number; value: number } | null;
  onPointerDown?: (point: GraphKeyframePoint, event: React.PointerEvent) => void;
  onClick?: (point: GraphKeyframePoint, event: React.MouseEvent) => void;
  onDoubleClick?: (point: GraphKeyframePoint, event: React.MouseEvent) => void;
  disabled?: boolean;
}) {
  return (
    <g className="graph-keyframes">
      {points.map((point) => (
        <GraphKeyframe
          key={point.keyframe.id}
          point={point}
          size={size}
          previewValues={point.isDragging ? previewValues : null}
          onPointerDown={onPointerDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          disabled={disabled}
        />
      ))}
    </g>
  );
});

/**
 * Format a keyframe value for display.
 */
function formatKeyframeValue(value: number): string {
  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}
