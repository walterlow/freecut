import type { BoundingBox, Point, Transform } from '../types/gizmo';

/**
 * Snap thresholds are authored in SCREEN pixels so the feel stays constant
 * across preview zoom levels. Callers pass the current canvasScale
 * (screen_px / canvas_px); we derive canvas-pixel thresholds per call.
 */
const SNAP_ENTER_THRESHOLD_SCREEN_PX = 8;
const SNAP_EXIT_THRESHOLD_SCREEN_PX = 18;

function getThresholds(canvasScale: number): { enter: number; exit: number } {
  const scale = canvasScale > 0 ? canvasScale : 1;
  return {
    enter: SNAP_ENTER_THRESHOLD_SCREEN_PX / scale,
    exit: SNAP_EXIT_THRESHOLD_SCREEN_PX / scale,
  };
}

/**
 * Generic best-(snap point, edge) search shared by translate and scale snap.
 * Returns the closest pair under threshold, with hysteresis against currently
 * held snap positions. Callers interpret `pos`/`edge` for their own purposes
 * (delta for translate, new half-size for scale).
 */
function findBestMatch<T extends { pos: number; label?: string }>(
  snapPoints: readonly T[],
  edges: readonly number[],
  currentSnapPositions: ReadonlySet<number>,
  enterThreshold: number,
  exitThreshold: number
): { snapPoint: T; edge: number; distance: number } | null {
  let best: { snapPoint: T; edge: number; distance: number } | null = null;
  for (const sp of snapPoints) {
    const threshold = currentSnapPositions.has(sp.pos) ? exitThreshold : enterThreshold;
    for (const edge of edges) {
      const distance = Math.abs(edge - sp.pos);
      if (distance >= threshold) continue;
      if (!best || distance < best.distance) {
        best = { snapPoint: sp, edge, distance };
      }
    }
  }
  return best;
}

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
 * Build per-item snap points for alignment to neighboring items.
 * Each item contributes three verticals (left / centerX / right) and three
 * horizontals (top / centerY / bottom). Duplicate positions are collapsed.
 */
function getOtherItemSnapPoints(bounds: BoundingBox[]) {
  const vertical = new Map<number, string>();
  const horizontal = new Map<number, string>();
  for (const b of bounds) {
    vertical.set(b.left, 'Align');
    vertical.set((b.left + b.right) / 2, 'Center');
    vertical.set(b.right, 'Align');
    horizontal.set(b.top, 'Align');
    horizontal.set((b.top + b.bottom) / 2, 'Center');
    horizontal.set(b.bottom, 'Align');
  }
  return {
    vertical: Array.from(vertical, ([pos, label]) => ({ pos, label })),
    horizontal: Array.from(horizontal, ([pos, label]) => ({ pos, label })),
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
/**
 * Compute the rotation-aware AABB of an item (in canvas coordinates),
 * optionally expanded by stroke width. Exposed for callers that need to
 * build the `otherItemBounds` set for item-to-item snapping.
 */
export function computeItemAabb(
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  strokeExpansion: number = 0
): BoundingBox {
  const b = getItemBounds(transform, canvasWidth, canvasHeight, strokeExpansion);
  return {
    left: b.left,
    top: b.top,
    right: b.right,
    bottom: b.bottom,
    width: b.right - b.left,
    height: b.bottom - b.top,
  };
}

function getItemBounds(
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  strokeExpansion: number = 0
) {
  // transform.x/y is the pre-rotation CENTER of the item in canvas space
  // (offset from canvas center). The renderer then applies CSS rotation with
  // transform-origin = anchor (relative to the item's top-left). For anchors
  // off-center this means the *visual* center drifts when rotated — so for
  // snap we must rotate corners around the anchor, not the geometric center.
  const centerX = canvasWidth / 2 + transform.x;
  const centerY = canvasHeight / 2 + transform.y;
  const expand = strokeExpansion / 2;
  const halfW = transform.width / 2 + expand;
  const halfH = transform.height / 2 + expand;

  // For unrotated items, anchor is irrelevant — AABB matches the rectangle.
  if (!transform.rotation) {
    return {
      left: centerX - halfW,
      right: centerX + halfW,
      top: centerY - halfH,
      bottom: centerY + halfH,
      centerX,
      centerY,
    };
  }

  const anchorOffsetX = (transform.anchorX ?? transform.width / 2) - transform.width / 2;
  const anchorOffsetY = (transform.anchorY ?? transform.height / 2) - transform.height / 2;
  const anchorX = centerX + anchorOffsetX;
  const anchorY = centerY + anchorOffsetY;

  const rad = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Fast path: centered anchor rotates symmetrically around the center, so
  // the rotated AABB has a closed form and the visual center stays put.
  if (anchorOffsetX === 0 && anchorOffsetY === 0) {
    const ex = Math.abs(halfW * cos) + Math.abs(halfH * sin);
    const ey = Math.abs(halfW * sin) + Math.abs(halfH * cos);
    return {
      left: centerX - ex,
      right: centerX + ex,
      top: centerY - ey,
      bottom: centerY + ey,
      centerX,
      centerY,
    };
  }

  // Off-center anchor: rotate each corner around the anchor and take the AABB.
  const corners: Array<[number, number]> = [
    [centerX - halfW, centerY - halfH],
    [centerX + halfW, centerY - halfH],
    [centerX + halfW, centerY + halfH],
    [centerX - halfW, centerY + halfH],
  ];
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [cx, cy] of corners) {
    const dx = cx - anchorX;
    const dy = cy - anchorY;
    const rx = anchorX + dx * cos - dy * sin;
    const ry = anchorY + dx * sin + dy * cos;
    if (rx < left) left = rx;
    if (rx > right) right = rx;
    if (ry < top) top = ry;
    if (ry > bottom) bottom = ry;
  }

  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
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
  strokeExpansion: number = 0,
  canvasScale: number = 1,
  otherItemBounds: BoundingBox[] = []
): SnapResult {
  const canvasSnap = getTranslateSnapPoints(canvasWidth, canvasHeight);
  const otherSnap = getOtherItemSnapPoints(otherItemBounds);
  // Canvas points come first so they win ties (preferred for edges/centers).
  const snapPoints = {
    vertical: [...canvasSnap.vertical, ...otherSnap.vertical],
    horizontal: [...canvasSnap.horizontal, ...otherSnap.horizontal],
  };
  const bounds = getItemBounds(transform, canvasWidth, canvasHeight, strokeExpansion);
  const snapLines: SnapLine[] = [];
  const { enter: enterThreshold, exit: exitThreshold } = getThresholds(canvasScale);

  // Check if currently snapped to vertical/horizontal lines
  const currentVerticalSnap = currentSnapLines.find((l) => l.type === 'vertical');
  const currentHorizontalSnap = currentSnapLines.find((l) => l.type === 'horizontal');

  let deltaX = 0;
  let deltaY = 0;

  // Pick the globally-closest (snapPoint, edge) pair per axis. Picking the
  // nearest edge avoids order-dependent bias — e.g. a small item straddling
  // a line used to always snap via its left edge because the old loop broke
  // on first match.
  const xEdges = [bounds.left, bounds.centerX, bounds.right];
  const yEdges = [bounds.top, bounds.centerY, bounds.bottom];
  const currentX = new Set(currentVerticalSnap ? [currentVerticalSnap.position] : []);
  const currentY = new Set(currentHorizontalSnap ? [currentHorizontalSnap.position] : []);

  const bestX = findBestMatch(snapPoints.vertical, xEdges, currentX, enterThreshold, exitThreshold);
  if (bestX) {
    deltaX = bestX.snapPoint.pos - bestX.edge;
    snapLines.push({
      type: 'vertical',
      position: bestX.snapPoint.pos,
      label: bestX.snapPoint.label,
    });
  }

  const bestY = findBestMatch(snapPoints.horizontal, yEdges, currentY, enterThreshold, exitThreshold);
  if (bestY) {
    deltaY = bestY.snapPoint.pos - bestY.edge;
    snapLines.push({
      type: 'horizontal',
      position: bestY.snapPoint.pos,
      label: bestY.snapPoint.label,
    });
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
  strokeExpansion: number = 0,
  canvasScale: number = 1,
  maintainAspectRatio: boolean = true
): SnapResult {
  const snapPoints = getScaleSnapPoints(canvasWidth, canvasHeight);
  const bounds = getItemBounds(transform, canvasWidth, canvasHeight, strokeExpansion);
  const snapLines: SnapLine[] = [];
  const aspectRatio = transform.width / transform.height;
  const { enter: enterThreshold, exit: exitThreshold } = getThresholds(canvasScale);

  // Check current snap positions for hysteresis
  const currentVerticalSnaps = currentSnapLines
    .filter((l) => l.type === 'vertical')
    .map((l) => l.position);
  const currentHorizontalSnaps = currentSnapLines
    .filter((l) => l.type === 'horizontal')
    .map((l) => l.position);

  // Find the best (snap point × edge) per axis so free-scale
  // (maintainAspectRatio=false) can snap width/height independently instead
  // of being forced onto the item's current aspect ratio.
  const currentVSet = new Set(currentVerticalSnaps);
  const currentHSet = new Set(currentHorizontalSnaps);

  const widthMatch = findBestMatch(
    snapPoints.vertical,
    [bounds.left, bounds.right],
    currentVSet,
    enterThreshold,
    exitThreshold
  );
  const heightMatch = findBestMatch(
    snapPoints.horizontal,
    [bounds.top, bounds.bottom],
    currentHSet,
    enterThreshold,
    exitThreshold
  );

  const bestWidth =
    widthMatch && {
      distance: widthMatch.distance,
      newValue:
        widthMatch.edge === bounds.left
          ? (bounds.centerX - widthMatch.snapPoint.pos) * 2
          : (widthMatch.snapPoint.pos - bounds.centerX) * 2,
      snapLine: {
        type: 'vertical' as const,
        position: widthMatch.snapPoint.pos,
        label: widthMatch.snapPoint.label,
      },
    };

  const bestHeight =
    heightMatch && {
      distance: heightMatch.distance,
      newValue:
        heightMatch.edge === bounds.top
          ? (bounds.centerY - heightMatch.snapPoint.pos) * 2
          : (heightMatch.snapPoint.pos - bounds.centerY) * 2,
      snapLine: {
        type: 'horizontal' as const,
        position: heightMatch.snapPoint.pos,
        label: heightMatch.snapPoint.label,
      },
    };

  // If no snap found on either axis, return rounded transform
  if (!bestWidth && !bestHeight) {
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

  let newWidth: number;
  let newHeight: number;

  if (maintainAspectRatio) {
    // Pick the closer of the two axis snaps and propagate through aspect.
    const chooseWidth =
      bestWidth && (!bestHeight || bestWidth.distance <= bestHeight.distance);
    if (chooseWidth && bestWidth) {
      newWidth = bestWidth.newValue;
      newHeight = newWidth / aspectRatio;
    } else if (bestHeight) {
      newHeight = bestHeight.newValue;
      newWidth = newHeight * aspectRatio;
    } else {
      // Unreachable — guarded above — but keep TS happy.
      newWidth = transform.width;
      newHeight = transform.height;
    }
  } else {
    // Free-scale: snap each axis independently, keep the unsnapped axis.
    newWidth = bestWidth ? bestWidth.newValue : transform.width;
    newHeight = bestHeight ? bestHeight.newValue : transform.height;
  }

  // Track position adjustments for 100% snap
  let newX = transform.x;
  let newY = transform.y;

  // Snap to exact canvas dimensions when width/height is close to canvas size
  // This handles 100% scale regardless of center position drift during fast movement
  const sizeTolerance = 15; // Generous tolerance for fast movement

  if (Math.abs(newWidth - canvasWidth) < sizeTolerance) {
    newWidth = canvasWidth;
    // Only propagate through aspect when it's locked — free-scale keeps
    // the independently-snapped height.
    if (maintainAspectRatio) newHeight = newWidth / aspectRatio;
    newX = 0; // Also center horizontally for perfect 100%
  }

  if (Math.abs(newHeight - canvasHeight) < sizeTolerance) {
    newHeight = canvasHeight;
    if (maintainAspectRatio) newWidth = newHeight * aspectRatio;
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

/**
 * Build a virtual Transform representing a group's axis-aligned bounds.
 * Used so the existing single-item snap helpers can operate on a group's
 * combined rectangle without duplicating the snap-point logic.
 */
function groupBoundsToVirtualTransform(
  bounds: BoundingBox,
  canvasWidth: number,
  canvasHeight: number
): Transform {
  return {
    x: (bounds.left + bounds.right) / 2 - canvasWidth / 2,
    y: (bounds.top + bounds.bottom) / 2 - canvasHeight / 2,
    width: bounds.width,
    height: bounds.height,
    rotation: 0,
    opacity: 1,
  };
}

/**
 * Snap calculation for group translation. Operates on the post-translate
 * group AABB and returns an additional delta to apply along with the snap
 * lines that triggered. Uses the same snap points / thresholds as single-item
 * translate snap so behaviour is consistent between single and multi select.
 */
export function applyGroupTranslationSnapping(
  postTranslateBounds: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
  currentSnapLines: SnapLine[] = [],
  canvasScale: number = 1,
  otherItemBounds: BoundingBox[] = []
): { deltaX: number; deltaY: number; snapLines: SnapLine[] } {
  const virtual = groupBoundsToVirtualTransform(postTranslateBounds, canvasWidth, canvasHeight);
  const { transform: snapped, snapLines } = applySnapping(
    virtual,
    canvasWidth,
    canvasHeight,
    currentSnapLines,
    0,
    canvasScale,
    otherItemBounds
  );
  return {
    deltaX: snapped.x - virtual.x,
    deltaY: snapped.y - virtual.y,
    snapLines,
  };
}

/**
 * Snap calculation for group scaling from a fixed center. Operates on the
 * post-scale group AABB and returns an adjusted uniform scale factor plus
 * snap lines. The group center stays fixed during scale, so only width/height
 * change — we ignore any x/y adjustments applyScaleSnapping might produce
 * for its single-item 100%-fit heuristic (those would break group layout).
 */
export function applyGroupScaleSnapping(
  postScaleBounds: BoundingBox,
  groupCenter: Point,
  originalWidth: number,
  originalHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  currentSnapLines: SnapLine[] = [],
  canvasScale: number = 1
): { scaleFactor: number; snapLines: SnapLine[] } {
  const virtual: Transform = {
    x: groupCenter.x - canvasWidth / 2,
    y: groupCenter.y - canvasHeight / 2,
    width: postScaleBounds.width,
    height: postScaleBounds.height,
    rotation: 0,
    opacity: 1,
  };
  const { transform: snapped, snapLines } = applyScaleSnapping(
    virtual,
    canvasWidth,
    canvasHeight,
    currentSnapLines,
    0,
    canvasScale
  );

  // Derive a single uniform scale factor from whichever axis gives the
  // most meaningful relative change. Both axes should be close since
  // applyScaleSnapping maintains aspect ratio for the virtual bounds.
  const widthRatio = originalWidth > 0 ? snapped.width / originalWidth : 1;
  const heightRatio = originalHeight > 0 ? snapped.height / originalHeight : 1;
  const scaleFactor =
    Math.abs(widthRatio - 1) >= Math.abs(heightRatio - 1) ? widthRatio : heightRatio;

  return { scaleFactor, snapLines };
}
