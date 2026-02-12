/**
 * Graph grid component.
 * Renders background grid lines and axis labels for the value graph.
 */

import { memo, useMemo } from 'react';
import type { GraphViewport } from './types';

interface GraphGridProps {
  /** Viewport dimensions and range */
  viewport: GraphViewport;
  /** Padding inside the graph area */
  padding: { top: number; right: number; bottom: number; left: number };
  /** Show axis labels */
  showLabels?: boolean;
  /** Major grid line interval for X (frames) */
  xMajorInterval?: number;
  /** Major grid line interval for Y (value) */
  yMajorInterval?: number;
}

/**
 * Background grid with axis labels.
 * Automatically calculates grid intervals based on viewport.
 */
export const GraphGrid = memo(function GraphGrid({
  viewport,
  padding,
  showLabels = true,
  xMajorInterval: xMajorProp,
  yMajorInterval: yMajorProp,
}: GraphGridProps) {
  const { width, height, startFrame, endFrame, minValue, maxValue } = viewport;

  // Calculate usable area
  const graphLeft = padding.left;
  const graphTop = padding.top;
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // Calculate frame and value ranges
  const frameRange = endFrame - startFrame;
  const valueRange = maxValue - minValue;

  // Auto-calculate intervals if not provided
  const xMajorInterval = useMemo(() => {
    if (xMajorProp) return xMajorProp;
    // Target ~5-10 major lines
    const pixelsPerFrame = graphWidth / frameRange;
    const targetSpacing = 80; // pixels
    const roughInterval = targetSpacing / pixelsPerFrame;
    // Round to nice numbers
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
    const normalized = roughInterval / magnitude;
    if (normalized < 2) return magnitude;
    if (normalized < 5) return 2 * magnitude;
    return 5 * magnitude;
  }, [xMajorProp, graphWidth, frameRange]);

  const yMajorInterval = useMemo(() => {
    if (yMajorProp) return yMajorProp;
    // Nice intervals including 0.25 for opacity and 45/90/180 for rotation
    const niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 45, 50, 90, 100, 180, 250, 500, 1000];
    // Target 4-6 major lines
    const targetLines = 5;
    const idealInterval = valueRange / targetLines;
    // Find the smallest nice interval >= idealInterval
    let bestInterval = niceIntervals[niceIntervals.length - 1];
    for (const interval of niceIntervals) {
      if (interval >= idealInterval) {
        bestInterval = interval;
        break;
      }
    }
    return bestInterval;
  }, [yMajorProp, valueRange]);

  // Generate vertical grid lines (X axis - frames)
  const xLines = useMemo(() => {
    const lines: Array<{ x: number; frame: number; isMajor: boolean }> = [];
    const minorInterval = xMajorInterval / 5;
    const firstFrame = Math.ceil(startFrame / minorInterval) * minorInterval;

    for (let frame = firstFrame; frame <= endFrame; frame += minorInterval) {
      const x = graphLeft + ((frame - startFrame) / frameRange) * graphWidth;
      const isMajor = Math.abs(frame % xMajorInterval) < 0.01;
      lines.push({ x, frame, isMajor });
    }
    return lines;
  }, [startFrame, endFrame, xMajorInterval, graphLeft, frameRange, graphWidth]);

  // Generate horizontal grid lines (Y axis - values)
  const yLines = useMemo(() => {
    if (!yMajorInterval) return [];
    const lines: Array<{ y: number; value: number; isMajor: boolean }> = [];
    // For small intervals, skip minor lines to avoid clutter
    const useMinorLines = yMajorInterval >= 1;
    const minorInterval = useMinorLines ? yMajorInterval / 5 : yMajorInterval;

    // Start from a clean multiple of the interval at or below minValue
    const firstValue = Math.floor(minValue / minorInterval) * minorInterval;
    // Use small epsilon for floating point comparison
    const epsilon = minorInterval * 0.001;

    for (let value = firstValue; value <= maxValue + epsilon; value += minorInterval) {
      // Snap to clean values to avoid floating point drift
      const snappedValue = Math.round(value / minorInterval) * minorInterval;
      if (snappedValue < minValue - epsilon || snappedValue > maxValue + epsilon) continue;

      const y = graphTop + (1 - (snappedValue - minValue) / valueRange) * graphHeight;
      // Check if major: value is a multiple of major interval
      const isMajor = Math.abs(Math.round(snappedValue / yMajorInterval) * yMajorInterval - snappedValue) < epsilon;
      lines.push({ y, value: snappedValue, isMajor });
    }
    return lines;
  }, [minValue, maxValue, yMajorInterval, graphTop, valueRange, graphHeight]);

  return (
    <g className="graph-grid">
      {/* Graph background */}
      <rect
        x={graphLeft}
        y={graphTop}
        width={graphWidth}
        height={graphHeight}
        fill="hsl(var(--muted) / 0.3)"
        rx={4}
      />

      {/* Vertical grid lines */}
      {xLines.map(({ x, frame, isMajor }) => (
        <line
          key={`x-${frame}`}
          x1={x}
          y1={graphTop}
          x2={x}
          y2={graphTop + graphHeight}
          stroke="currentColor"
          strokeOpacity={isMajor ? 0.15 : 0.05}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      ))}

      {/* Horizontal grid lines */}
      {yLines.map(({ y, value, isMajor }) => (
        <line
          key={`y-${value}`}
          x1={graphLeft}
          y1={y}
          x2={graphLeft + graphWidth}
          y2={y}
          stroke="currentColor"
          strokeOpacity={isMajor ? 0.15 : 0.05}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      ))}

      {/* Zero line (if visible) */}
      {minValue <= 0 && maxValue >= 0 && (
        <line
          x1={graphLeft}
          y1={graphTop + (1 - (0 - minValue) / valueRange) * graphHeight}
          x2={graphLeft + graphWidth}
          y2={graphTop + (1 - (0 - minValue) / valueRange) * graphHeight}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeWidth={1}
        />
      )}

      {/* X axis labels (frames) */}
      {showLabels &&
        xLines
          .filter((l) => l.isMajor)
          .map(({ x, frame }) => (
            <text
              key={`x-label-${frame}`}
              x={x}
              y={height - padding.bottom / 3}
              textAnchor="middle"
              fill="currentColor"
              fillOpacity={0.6}
              fontSize={9}
              fontFamily="monospace"
            >
              F{Math.round(frame)}
            </text>
          ))}

      {/* Y axis labels (values) */}
      {showLabels &&
        yLines
          .filter((l) => l.isMajor)
          .map(({ y, value }) => (
            <text
              key={`y-label-${value}`}
              x={padding.left - 4}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fill="currentColor"
              fillOpacity={0.6}
              fontSize={9}
              fontFamily="monospace"
            >
              {formatValue(value)}
            </text>
          ))}

      {/* Graph border */}
      <rect
        x={graphLeft}
        y={graphTop}
        width={graphWidth}
        height={graphHeight}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={1}
        rx={4}
      />
    </g>
  );
});

/**
 * Format a value for display (handles decimals nicely).
 */
function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}
