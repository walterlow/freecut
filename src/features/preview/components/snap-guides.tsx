import { useMemo } from 'react';
import type { SnapLine } from '../utils/canvas-snap-utils';
import type { CoordinateParams } from '../types/gizmo';
import { getEffectiveScale } from '../utils/coordinate-transform';

interface SnapGuidesProps {
  snapLines: SnapLine[];
  coordParams: CoordinateParams;
}

/**
 * Renders visual guides for active snap lines.
 * Shows colored lines across the canvas when items snap to edges or percentage positions.
 */
export function SnapGuides({ snapLines, coordParams }: SnapGuidesProps) {
  const scale = useMemo(() => getEffectiveScale(coordParams), [coordParams]);

  if (snapLines.length === 0) {
    return null;
  }

  return (
    <>
      {snapLines.map((line, index) => {
        // Convert canvas coordinate to screen coordinate
        const screenPos = line.position * scale;

        if (line.type === 'vertical') {
          return (
            <div
              key={`v-${index}-${line.position}`}
              className="absolute pointer-events-none"
              style={{
                left: screenPos,
                top: 0,
                width: 1,
                height: '100%',
                backgroundColor: '#f472b6', // Pink color for visibility
                boxShadow: '0 0 4px #f472b6',
              }}
            >
              {/* Label */}
              {line.label && (
                <span
                  className="absolute text-xs font-medium px-1 rounded"
                  style={{
                    top: 4,
                    left: 4,
                    backgroundColor: '#f472b6',
                    color: 'white',
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {line.label}
                </span>
              )}
            </div>
          );
        }

        // Horizontal line
        return (
          <div
            key={`h-${index}-${line.position}`}
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: screenPos,
              width: '100%',
              height: 1,
              backgroundColor: '#f472b6',
              boxShadow: '0 0 4px #f472b6',
            }}
          >
            {/* Label */}
            {line.label && (
              <span
                className="absolute text-xs font-medium px-1 rounded"
                style={{
                  left: 4,
                  top: 4,
                  backgroundColor: '#f472b6',
                  color: 'white',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                }}
              >
                {line.label}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
