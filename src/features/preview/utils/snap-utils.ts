import type { Transform } from '../types/gizmo';

/** Snap threshold to enter a snap (in canvas pixels) */
const SNAP_ENTER_THRESHOLD = 8;
/** Snap threshold to exit a snap - larger for "sticky" feeling */
const SNAP_EXIT_THRESHOLD = 18;

/** Snap line type for visual feedback */
export interface SnapLine {
  type: 'horizontal' | 'vertical';
  position: number; // Canvas coordinate
  label?: string;
}

/** Result of snap calculation */
interface SnapResult {
  transform: Transform;
  snapLines: SnapLine[];
}

/**
 * Calculate canvas snap points for translate operations.
 * Only includes edges and center to reduce visual noise.
 */
function getTranslateSnapPoints(canvasWidth: number, canvasHeight: number) {
  return {
    vertical: [
      { pos: 0, label: 'Edge' },
      { pos: canvasWidth * 0.5, label: '50%' },
      { pos: canvasWidth, label: 'Edge' },
    ],
    horizontal: [
      { pos: 0, label: 'Edge' },
      { pos: canvasHeight * 0.5, label: '50%' },
      { pos: canvasHeight, label: 'Edge' },
    ],
  };
}

/**
 * Calculate canvas snap points for scale operations.
 * Includes edges and percentage-based positions.
 */
function getScaleSnapPoints(canvasWidth: number, canvasHeight: number) {
  return {
    vertical: [
      { pos: 0, label: '0%' },
      { pos: canvasWidth * 0.25, label: '25%' },
      { pos: canvasWidth * 0.5, label: '50%' },
      { pos: canvasWidth * 0.75, label: '75%' },
      { pos: canvasWidth, label: '100%' },
    ],
    horizontal: [
      { pos: 0, label: '0%' },
      { pos: canvasHeight * 0.25, label: '25%' },
      { pos: canvasHeight * 0.5, label: '50%' },
      { pos: canvasHeight * 0.75, label: '75%' },
      { pos: canvasHeight, label: '100%' },
    ],
  };
}

/**
 * Get item edges and center in canvas coordinates.
 * Transform x/y is offset from canvas center.
 * @param strokeExpansion - Optional stroke width to expand bounds (for shapes with strokes)
 */
function getItemBounds(
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  strokeExpansion: number = 0
) {
  const centerX = canvasWidth / 2 + transform.x;
  const centerY = canvasHeight / 2 + transform.y;
  // Expand bounds by half stroke on each side
  const expand = strokeExpansion / 2;

  return {
    left: centerX - transform.width / 2 - expand,
    right: centerX + transform.width / 2 + expand,
    top: centerY - transform.height / 2 - expand,
    bottom: centerY + transform.height / 2 + expand,
    centerX,
    centerY,
  };
}

/**
 * Apply snapping to a transform during drag operations.
 * Snaps item edges and center to canvas snap points.
 * Uses hysteresis (sticky snapping) - harder to exit a snap than to enter it.
 * @param strokeExpansion - Optional stroke width to expand bounds (for shapes with strokes)
 */
export function applySnapping(
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  currentSnapLines: SnapLine[] = [],
  strokeExpansion: number = 0
): SnapResult {
  const snapPoints = getTranslateSnapPoints(canvasWidth, canvasHeight);
  const bounds = getItemBounds(transform, canvasWidth, canvasHeight, strokeExpansion);
  const snapLines: SnapLine[] = [];

  // Check if currently snapped to vertical/horizontal lines
  const currentVerticalSnap = currentSnapLines.find((l) => l.type === 'vertical');
  const currentHorizontalSnap = currentSnapLines.find((l) => l.type === 'horizontal');

  let deltaX = 0;
  let deltaY = 0;

  // Check vertical snap points (for horizontal position)
  const xEdges = [
    { edge: bounds.left, type: 'left' },
    { edge: bounds.centerX, type: 'center' },
    { edge: bounds.right, type: 'right' },
  ];

  for (const snapPoint of snapPoints.vertical) {
    for (const { edge } of xEdges) {
      const distance = Math.abs(edge - snapPoint.pos);
      // Use exit threshold if currently snapped to this point, enter threshold otherwise
      const isCurrentSnap = currentVerticalSnap?.position === snapPoint.pos;
      const threshold = isCurrentSnap ? SNAP_EXIT_THRESHOLD : SNAP_ENTER_THRESHOLD;

      if (distance < threshold) {
        const snapDelta = snapPoint.pos - edge;
        if (deltaX === 0 || Math.abs(snapDelta) < Math.abs(deltaX)) {
          deltaX = snapDelta;
          const existingLine = snapLines.find(
            (l) => l.type === 'vertical' && l.position === snapPoint.pos
          );
          if (!existingLine) {
            snapLines.push({
              type: 'vertical',
              position: snapPoint.pos,
              label: snapPoint.label,
            });
          }
        }
        break;
      }
    }
  }

  // Check horizontal snap points (for vertical position)
  const yEdges = [
    { edge: bounds.top, type: 'top' },
    { edge: bounds.centerY, type: 'center' },
    { edge: bounds.bottom, type: 'bottom' },
  ];

  for (const snapPoint of snapPoints.horizontal) {
    for (const { edge } of yEdges) {
      const distance = Math.abs(edge - snapPoint.pos);
      const isCurrentSnap = currentHorizontalSnap?.position === snapPoint.pos;
      const threshold = isCurrentSnap ? SNAP_EXIT_THRESHOLD : SNAP_ENTER_THRESHOLD;

      if (distance < threshold) {
        const snapDelta = snapPoint.pos - edge;
        if (deltaY === 0 || Math.abs(snapDelta) < Math.abs(deltaY)) {
          deltaY = snapDelta;
          const existingLine = snapLines.find(
            (l) => l.type === 'horizontal' && l.position === snapPoint.pos
          );
          if (!existingLine) {
            snapLines.push({
              type: 'horizontal',
              position: snapPoint.pos,
              label: snapPoint.label,
            });
          }
        }
        break;
      }
    }
  }

  // Apply snap deltas to transform
  // Round to integers to avoid subpixel values
  const snappedTransform: Transform = {
    ...transform,
    x: Math.round(transform.x + deltaX),
    y: Math.round(transform.y + deltaY),
  };

  return {
    transform: snappedTransform,
    snapLines,
  };
}

/**
 * Apply snapping during scale operations.
 * Snaps item edges to canvas snap points while maintaining aspect ratio.
 * Uses uniform scaling to prevent visual distortion.
 * Uses hysteresis (sticky snapping) - harder to exit a snap than to enter it.
 * @param strokeExpansion - Optional stroke width to expand bounds (for shapes with strokes)
 */
export function applyScaleSnapping(
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  currentSnapLines: SnapLine[] = [],
  strokeExpansion: number = 0
): SnapResult {
  const snapPoints = getScaleSnapPoints(canvasWidth, canvasHeight);
  const bounds = getItemBounds(transform, canvasWidth, canvasHeight, strokeExpansion);
  const snapLines: SnapLine[] = [];
  const aspectRatio = transform.width / transform.height;

  // Check current snap positions for hysteresis
  const currentVerticalSnaps = currentSnapLines
    .filter((l) => l.type === 'vertical')
    .map((l) => l.position);
  const currentHorizontalSnaps = currentSnapLines
    .filter((l) => l.type === 'horizontal')
    .map((l) => l.position);

  // Find the best snap (closest edge to a snap point)
  let bestSnap: {
    type: 'width' | 'height';
    newValue: number;
    distance: number;
    snapLine: SnapLine;
  } | null = null;

  // Check vertical snap points (affects width via left/right edges)
  for (const snapPoint of snapPoints.vertical) {
    const isCurrentSnap = currentVerticalSnaps.includes(snapPoint.pos);
    const threshold = isCurrentSnap ? SNAP_EXIT_THRESHOLD : SNAP_ENTER_THRESHOLD;

    // Check left edge
    const leftDist = Math.abs(bounds.left - snapPoint.pos);
    if (leftDist < threshold) {
      const halfWidth = bounds.centerX - snapPoint.pos;
      const newWidth = halfWidth * 2;
      if (!bestSnap || leftDist < bestSnap.distance) {
        bestSnap = {
          type: 'width',
          newValue: newWidth,
          distance: leftDist,
          snapLine: { type: 'vertical', position: snapPoint.pos, label: snapPoint.label },
        };
      }
    }

    // Check right edge
    const rightDist = Math.abs(bounds.right - snapPoint.pos);
    if (rightDist < threshold) {
      const halfWidth = snapPoint.pos - bounds.centerX;
      const newWidth = halfWidth * 2;
      if (!bestSnap || rightDist < bestSnap.distance) {
        bestSnap = {
          type: 'width',
          newValue: newWidth,
          distance: rightDist,
          snapLine: { type: 'vertical', position: snapPoint.pos, label: snapPoint.label },
        };
      }
    }
  }

  // Check horizontal snap points (affects height via top/bottom edges)
  for (const snapPoint of snapPoints.horizontal) {
    const isCurrentSnap = currentHorizontalSnaps.includes(snapPoint.pos);
    const threshold = isCurrentSnap ? SNAP_EXIT_THRESHOLD : SNAP_ENTER_THRESHOLD;

    // Check top edge
    const topDist = Math.abs(bounds.top - snapPoint.pos);
    if (topDist < threshold) {
      const halfHeight = bounds.centerY - snapPoint.pos;
      const newHeight = halfHeight * 2;
      if (!bestSnap || topDist < bestSnap.distance) {
        bestSnap = {
          type: 'height',
          newValue: newHeight,
          distance: topDist,
          snapLine: { type: 'horizontal', position: snapPoint.pos, label: snapPoint.label },
        };
      }
    }

    // Check bottom edge
    const bottomDist = Math.abs(bounds.bottom - snapPoint.pos);
    if (bottomDist < threshold) {
      const halfHeight = snapPoint.pos - bounds.centerY;
      const newHeight = halfHeight * 2;
      if (!bestSnap || bottomDist < bestSnap.distance) {
        bestSnap = {
          type: 'height',
          newValue: newHeight,
          distance: bottomDist,
          snapLine: { type: 'horizontal', position: snapPoint.pos, label: snapPoint.label },
        };
      }
    }
  }

  // If no snap found, return rounded transform
  if (!bestSnap) {
    return {
      transform: {
        ...transform,
        x: Math.round(transform.x),
        y: Math.round(transform.y),
        width: Math.round(transform.width),
        height: Math.round(transform.height),
      },
      snapLines: [],
    };
  }

  // Apply snap while maintaining aspect ratio (uniform scale)
  let newWidth: number;
  let newHeight: number;

  if (bestSnap.type === 'width') {
    newWidth = bestSnap.newValue;
    newHeight = newWidth / aspectRatio;
  } else {
    newHeight = bestSnap.newValue;
    newWidth = newHeight * aspectRatio;
  }

  // Track position adjustments for 100% snap
  let newX = transform.x;
  let newY = transform.y;

  // Snap to exact canvas dimensions when width/height is close to canvas size
  // This handles 100% scale regardless of center position drift during fast movement
  const sizeTolerance = 15; // Generous tolerance for fast movement

  if (Math.abs(newWidth - canvasWidth) < sizeTolerance) {
    newWidth = canvasWidth;
    newHeight = newWidth / aspectRatio;
    newX = 0; // Also center horizontally for perfect 100%
  }

  if (Math.abs(newHeight - canvasHeight) < sizeTolerance) {
    newHeight = canvasHeight;
    newWidth = newHeight * aspectRatio;
    newY = 0; // Also center vertically for perfect 100%
  }

  const edgeTolerance = 3;

  // Recalculate bounds with adjusted position for snap line display
  const finalCenterX = canvasWidth / 2 + newX;
  const finalCenterY = canvasHeight / 2 + newY;
  const snappedBounds = {
    left: finalCenterX - newWidth / 2,
    right: finalCenterX + newWidth / 2,
    top: finalCenterY - newHeight / 2,
    bottom: finalCenterY + newHeight / 2,
  };

  // Check if edges align with snap points for visual feedback
  for (const snapPoint of snapPoints.vertical) {
    if (Math.abs(snappedBounds.left - snapPoint.pos) < edgeTolerance) {
      snapLines.push({ type: 'vertical', position: snapPoint.pos, label: snapPoint.label });
    }
    if (Math.abs(snappedBounds.right - snapPoint.pos) < edgeTolerance) {
      snapLines.push({ type: 'vertical', position: snapPoint.pos, label: snapPoint.label });
    }
  }

  for (const snapPoint of snapPoints.horizontal) {
    if (Math.abs(snappedBounds.top - snapPoint.pos) < edgeTolerance) {
      snapLines.push({ type: 'horizontal', position: snapPoint.pos, label: snapPoint.label });
    }
    if (Math.abs(snappedBounds.bottom - snapPoint.pos) < edgeTolerance) {
      snapLines.push({ type: 'horizontal', position: snapPoint.pos, label: snapPoint.label });
    }
  }

  // Round to integers
  let finalWidth = Math.round(Math.max(20, newWidth));
  let finalHeight = Math.round(Math.max(20, newHeight));
  let finalX = Math.round(newX);
  let finalY = Math.round(newY);

  // Final check: force exact canvas dimensions if very close
  // This catches edge cases from floating point calculations
  const finalTolerance = 5;
  if (Math.abs(finalWidth - canvasWidth) <= finalTolerance) {
    finalWidth = canvasWidth;
    finalX = 0;
  }
  if (Math.abs(finalHeight - canvasHeight) <= finalTolerance) {
    finalHeight = canvasHeight;
    finalY = 0;
  }

  const snappedTransform: Transform = {
    ...transform,
    x: finalX,
    y: finalY,
    width: finalWidth,
    height: finalHeight,
  };

  return {
    transform: snappedTransform,
    snapLines,
  };
}
