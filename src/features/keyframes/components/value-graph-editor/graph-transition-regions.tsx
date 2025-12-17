/**
 * Graph Transition Regions Component
 * Renders semi-transparent overlay regions on the keyframe graph
 * to indicate frame ranges where keyframes cannot be placed (transition regions).
 */

import { memo, useMemo } from 'react';
import type { GraphViewport } from './types';
import type { BlockedFrameRange } from '../../utils/transition-region';

interface GraphTransitionRegionsProps {
  /** Viewport dimensions and range */
  viewport: GraphViewport;
  /** Padding inside the graph area */
  padding: { top: number; right: number; bottom: number; left: number };
  /** Blocked frame ranges (from transitions) */
  blockedRanges: BlockedFrameRange[];
}

/**
 * Renders semi-transparent overlay regions for transition-blocked frames.
 * Displayed behind keyframes and curves to indicate where keyframes cannot be placed.
 */
export const GraphTransitionRegions = memo(function GraphTransitionRegions({
  viewport,
  padding,
  blockedRanges,
}: GraphTransitionRegionsProps) {
  const { width, height, startFrame, endFrame } = viewport;

  // Calculate usable area
  const graphLeft = padding.left;
  const graphTop = padding.top;
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;
  const frameRange = endFrame - startFrame;

  // Convert frame ranges to pixel coordinates
  const regions = useMemo(() => {
    if (blockedRanges.length === 0 || frameRange <= 0) return [];

    return blockedRanges.map((range, index) => {
      // Clamp range to visible area
      const visibleStart = Math.max(range.start, startFrame);
      const visibleEnd = Math.min(range.end, endFrame);

      // Skip if completely outside viewport
      if (visibleStart >= visibleEnd) return null;

      // Convert to pixel coordinates
      const x = graphLeft + ((visibleStart - startFrame) / frameRange) * graphWidth;
      const regionWidth = ((visibleEnd - visibleStart) / frameRange) * graphWidth;

      return {
        key: `${range.transition.id}-${range.role}-${index}`,
        x,
        width: regionWidth,
        role: range.role,
      };
    }).filter(Boolean);
  }, [blockedRanges, startFrame, endFrame, frameRange, graphLeft, graphWidth]);

  if (regions.length === 0) return null;

  // Unique pattern ID for defs
  const patternId = 'transition-blocked-stripes';

  return (
    <g className="graph-transition-regions">
      {/* Define the diagonal stripes pattern once */}
      <defs>
        <pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          width="10"
          height="10"
          patternTransform="rotate(-45)"
        >
          {/* Alternating stripes - using direct colors */}
          <rect width="10" height="10" fill="rgba(239, 68, 68, 0.15)" />
          <rect width="4" height="10" fill="rgba(239, 68, 68, 0.35)" />
        </pattern>
      </defs>

      {regions.map((region) => {
        if (!region) return null;

        // Calculate label position
        const labelX = region.x + region.width / 2;
        const labelY = graphTop + 16;

        return (
          <g key={region.key}>
            {/* Solid background first for visibility */}
            <rect
              x={region.x}
              y={graphTop}
              width={region.width}
              height={graphHeight}
              fill="rgba(239, 68, 68, 0.1)"
            />
            {/* Striped overlay */}
            <rect
              x={region.x}
              y={graphTop}
              width={region.width}
              height={graphHeight}
              fill={`url(#${patternId})`}
            />
            {/* Solid border edges */}
            <line
              x1={region.x}
              y1={graphTop}
              x2={region.x}
              y2={graphTop + graphHeight}
              stroke="rgba(239, 68, 68, 0.7)"
              strokeWidth={2}
            />
            <line
              x1={region.x + region.width}
              y1={graphTop}
              x2={region.x + region.width}
              y2={graphTop + graphHeight}
              stroke="rgba(239, 68, 68, 0.7)"
              strokeWidth={2}
            />
            {/* Label if region is wide enough */}
            {region.width > 50 && (
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fill="rgba(239, 68, 68, 0.9)"
                fontSize={10}
                fontWeight={600}
              >
                TRANSITION
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});
