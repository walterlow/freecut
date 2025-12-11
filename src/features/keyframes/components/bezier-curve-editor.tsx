/**
 * Bezier curve editor component.
 * Interactive SVG-based editor for cubic bezier easing curves.
 */

import { memo, useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { BezierControlPoints } from '@/types/keyframe';

interface BezierCurveEditorProps {
  /** Current bezier control points */
  value: BezierControlPoints;
  /** Callback when control points change */
  onChange: (value: BezierControlPoints) => void;
  /** Width of the editor in pixels */
  width?: number;
  /** Height of the editor in pixels */
  height?: number;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

/** Padding inside the editor */
const PADDING = 16;

/** Size of draggable control point handles */
const HANDLE_SIZE = 10;

/**
 * Interactive bezier curve editor.
 * Allows dragging control points to customize the easing curve.
 */
export const BezierCurveEditor = memo(function BezierCurveEditor({
  value,
  onChange,
  width = 200,
  height = 200,
  disabled = false,
  className,
}: BezierCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<'p1' | 'p2' | null>(null);

  // Calculate usable area
  const usableWidth = width - PADDING * 2;
  const usableHeight = height - PADDING * 2;

  // Convert bezier coordinates (0-1) to SVG coordinates
  const toSvgX = useCallback(
    (x: number) => PADDING + x * usableWidth,
    [usableWidth]
  );
  const toSvgY = useCallback(
    (y: number) => PADDING + (1 - y) * usableHeight, // Invert Y (SVG has Y down)
    [usableHeight]
  );

  // Convert SVG coordinates to bezier coordinates (0-1)
  const fromSvgX = useCallback(
    (svgX: number) => Math.max(0, Math.min(1, (svgX - PADDING) / usableWidth)),
    [usableWidth]
  );
  const fromSvgY = useCallback(
    (svgY: number) => Math.max(-0.5, Math.min(1.5, 1 - (svgY - PADDING) / usableHeight)),
    [usableHeight]
  );

  // Start point (0, 0) and end point (1, 1) in SVG coords
  const startX = toSvgX(0);
  const startY = toSvgY(0);
  const endX = toSvgX(1);
  const endY = toSvgY(1);

  // Control points in SVG coords
  const cp1X = toSvgX(value.x1);
  const cp1Y = toSvgY(value.y1);
  const cp2X = toSvgX(value.x2);
  const cp2Y = toSvgY(value.y2);

  // Handle drag start
  const handleMouseDown = useCallback(
    (point: 'p1' | 'p2') => (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      setDragging(point);
    },
    [disabled]
  );

  // Handle drag move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !svgRef.current || disabled) return;

      const rect = svgRef.current.getBoundingClientRect();
      const svgX = e.clientX - rect.left;
      const svgY = e.clientY - rect.top;

      const newX = fromSvgX(svgX);
      const newY = fromSvgY(svgY);

      if (dragging === 'p1') {
        onChange({
          ...value,
          x1: newX,
          y1: newY,
        });
      } else {
        onChange({
          ...value,
          x2: newX,
          y2: newY,
        });
      }
    },
    [dragging, disabled, fromSvgX, fromSvgY, onChange, value]
  );

  // Handle drag end
  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    if (dragging) {
      setDragging(null);
    }
  }, [dragging]);

  // Generate the bezier curve path
  const curvePath = `M ${startX},${startY} C ${cp1X},${cp1Y} ${cp2X},${cp2Y} ${endX},${endY}`;

  // Control point handle lines
  const line1Path = `M ${startX},${startY} L ${cp1X},${cp1Y}`;
  const line2Path = `M ${endX},${endY} L ${cp2X},${cp2Y}`;

  return (
    <div className={cn('relative', className)}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className={cn(
          'bg-muted/30 rounded-md border border-border',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        <defs>
          <pattern
            id="grid"
            width={usableWidth / 4}
            height={usableHeight / 4}
            patternUnits="userSpaceOnUse"
            x={PADDING}
            y={PADDING}
          >
            <path
              d={`M ${usableWidth / 4} 0 L 0 0 0 ${usableHeight / 4}`}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          </pattern>
        </defs>
        <rect
          x={PADDING}
          y={PADDING}
          width={usableWidth}
          height={usableHeight}
          fill="url(#grid)"
        />

        {/* Diagonal reference line (linear) */}
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Control point lines */}
        <path
          d={line1Path}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeOpacity={0.5}
          strokeWidth={1}
        />
        <path
          d={line2Path}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeOpacity={0.5}
          strokeWidth={1}
        />

        {/* Bezier curve */}
        <path
          d={curvePath}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={2.5}
          strokeLinecap="round"
        />

        {/* Start point (fixed) */}
        <circle
          cx={startX}
          cy={startY}
          r={4}
          fill="hsl(var(--background))"
          stroke="currentColor"
          strokeWidth={2}
        />

        {/* End point (fixed) */}
        <circle
          cx={endX}
          cy={endY}
          r={4}
          fill="hsl(var(--background))"
          stroke="currentColor"
          strokeWidth={2}
        />

        {/* Control point 1 (draggable) */}
        <circle
          cx={cp1X}
          cy={cp1Y}
          r={HANDLE_SIZE / 2}
          fill="hsl(var(--primary))"
          stroke="hsl(var(--background))"
          strokeWidth={2}
          className={cn(
            'transition-transform',
            !disabled && 'cursor-grab hover:scale-125',
            dragging === 'p1' && 'scale-125 cursor-grabbing'
          )}
          onMouseDown={handleMouseDown('p1')}
        />

        {/* Control point 2 (draggable) */}
        <circle
          cx={cp2X}
          cy={cp2Y}
          r={HANDLE_SIZE / 2}
          fill="hsl(var(--primary))"
          stroke="hsl(var(--background))"
          strokeWidth={2}
          className={cn(
            'transition-transform',
            !disabled && 'cursor-grab hover:scale-125',
            dragging === 'p2' && 'scale-125 cursor-grabbing'
          )}
          onMouseDown={handleMouseDown('p2')}
        />
      </svg>

      {/* Coordinate display */}
      <div className="mt-2 flex justify-between text-xs text-muted-foreground font-mono">
        <span>
          P1: ({value.x1.toFixed(2)}, {value.y1.toFixed(2)})
        </span>
        <span>
          P2: ({value.x2.toFixed(2)}, {value.y2.toFixed(2)})
        </span>
      </div>
    </div>
  );
});

/**
 * Compact bezier curve preview (non-interactive).
 * Used in preset thumbnails and picker triggers.
 */
export const BezierCurvePreview = memo(function BezierCurvePreview({
  value,
  width = 48,
  height = 48,
  className,
}: {
  value: BezierControlPoints;
  width?: number;
  height?: number;
  className?: string;
}) {
  const padding = 4;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const toSvgX = (x: number) => padding + x * usableWidth;
  const toSvgY = (y: number) => padding + (1 - y) * usableHeight;

  const startX = toSvgX(0);
  const startY = toSvgY(0);
  const endX = toSvgX(1);
  const endY = toSvgY(1);
  const cp1X = toSvgX(value.x1);
  const cp1Y = toSvgY(value.y1);
  const cp2X = toSvgX(value.x2);
  const cp2Y = toSvgY(value.y2);

  const curvePath = `M ${startX},${startY} C ${cp1X},${cp1Y} ${cp2X},${cp2Y} ${endX},${endY}`;

  return (
    <svg
      width={width}
      height={height}
      className={cn('bg-muted/30 rounded', className)}
    >
      {/* Background box */}
      <rect
        x={padding}
        y={padding}
        width={usableWidth}
        height={usableHeight}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.1}
        strokeWidth={1}
      />
      {/* Curve */}
      <path
        d={curvePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
});
