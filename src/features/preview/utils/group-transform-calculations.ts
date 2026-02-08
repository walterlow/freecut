import type { Transform, Point, BoundingBox, GroupTransformState } from '../types/gizmo';
import { rotatePoint, getTransformCenter } from './coordinate-transform';

const MIN_SIZE = 20;

/**
 * Calculate the axis-aligned bounding box that encompasses all rotated items.
 * Accounts for item rotation by computing rotated corner positions.
 */
export function calculateGroupBounds(
  transforms: Map<string, Transform>,
  canvasWidth: number,
  canvasHeight: number
): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const transform of transforms.values()) {
    // Get item center in canvas coordinates
    const center = getTransformCenter(transform, canvasWidth, canvasHeight);
    const halfWidth = transform.width / 2;
    const halfHeight = transform.height / 2;

    // If no rotation, use simple bounds
    if (transform.rotation === 0) {
      minX = Math.min(minX, center.x - halfWidth);
      minY = Math.min(minY, center.y - halfHeight);
      maxX = Math.max(maxX, center.x + halfWidth);
      maxY = Math.max(maxY, center.y + halfHeight);
      continue;
    }

    // With rotation, calculate all 4 corners
    const corners = [
      { x: center.x - halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y + halfHeight },
      { x: center.x - halfWidth, y: center.y + halfHeight },
    ];

    for (const corner of corners) {
      const rotated = rotatePoint(corner, center, transform.rotation);
      minX = Math.min(minX, rotated.x);
      minY = Math.min(minY, rotated.y);
      maxX = Math.max(maxX, rotated.x);
      maxY = Math.max(maxY, rotated.y);
    }
  }

  return {
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Initialize group transform state with relative offsets from group center.
 */
export function initializeGroupState(
  itemIds: string[],
  transforms: Map<string, Transform>,
  canvasWidth: number,
  canvasHeight: number
): GroupTransformState {
  const groupBounds = calculateGroupBounds(transforms, canvasWidth, canvasHeight);
  const groupCenter: Point = {
    x: (groupBounds.left + groupBounds.right) / 2,
    y: (groupBounds.top + groupBounds.bottom) / 2,
  };

  const itemOffsets = new Map<string, Point>();
  const itemRotations = new Map<string, number>();

  for (const [id, transform] of transforms) {
    // Item center in canvas coordinates
    const itemCenter = getTransformCenter(transform, canvasWidth, canvasHeight);

    // Offset from group center
    itemOffsets.set(id, {
      x: itemCenter.x - groupCenter.x,
      y: itemCenter.y - groupCenter.y,
    });

    itemRotations.set(id, transform.rotation);
  }

  return {
    itemIds,
    groupBounds,
    groupCenter,
    itemTransforms: new Map(transforms),
    itemOffsets,
    itemRotations,
  };
}

/**
 * Apply group translation to all items.
 */
export function applyGroupTranslation(
  groupState: GroupTransformState,
  deltaX: number,
  deltaY: number
): Map<string, Transform> {
  const result = new Map<string, Transform>();

  for (const [id, startTransform] of groupState.itemTransforms) {
    result.set(id, {
      ...startTransform,
      x: startTransform.x + deltaX,
      y: startTransform.y + deltaY,
    });
  }

  return result;
}

/**
 * Apply group scale to all items (Figma-like behavior).
 * Scale is relative to group center, maintaining relative positions.
 */
export function applyGroupScale(
  groupState: GroupTransformState,
  scaleFactorX: number,
  scaleFactorY: number,
  canvasWidth: number,
  canvasHeight: number,
  maintainAspectRatio: boolean = true
): Map<string, Transform> {
  const result = new Map<string, Transform>();
  const { groupCenter, itemOffsets, itemTransforms } = groupState;

  // For aspect ratio lock, use uniform scale
  const scaleFactor = maintainAspectRatio
    ? Math.max(scaleFactorX, scaleFactorY)
    : 1;
  const finalScaleX = maintainAspectRatio ? scaleFactor : scaleFactorX;
  const finalScaleY = maintainAspectRatio ? scaleFactor : scaleFactorY;

  // Enforce minimum scale to prevent collapse
  const minScaleX = MIN_SIZE / Math.max(...Array.from(itemTransforms.values()).map(t => t.width));
  const minScaleY = MIN_SIZE / Math.max(...Array.from(itemTransforms.values()).map(t => t.height));
  const clampedScaleX = Math.max(minScaleX, finalScaleX);
  const clampedScaleY = Math.max(minScaleY, finalScaleY);

  for (const [id, startTransform] of itemTransforms) {
    const offset = itemOffsets.get(id)!;

    // Scale the offset from group center
    const newOffsetX = offset.x * clampedScaleX;
    const newOffsetY = offset.y * clampedScaleY;

    // New center in canvas coordinates
    const newCenterX = groupCenter.x + newOffsetX;
    const newCenterY = groupCenter.y + newOffsetY;

    // Convert back to transform coordinates (offset from canvas center)
    result.set(id, {
      ...startTransform,
      x: newCenterX - canvasWidth / 2,
      y: newCenterY - canvasHeight / 2,
      width: Math.max(MIN_SIZE, startTransform.width * clampedScaleX),
      height: Math.max(MIN_SIZE, startTransform.height * clampedScaleY),
    });
  }

  return result;
}

/**
 * Apply group rotation to all items (Figma-like behavior).
 * Items rotate around the group center, and their individual rotations are updated.
 */
export function applyGroupRotation(
  groupState: GroupTransformState,
  rotationDelta: number,
  canvasWidth: number,
  canvasHeight: number
): Map<string, Transform> {
  const result = new Map<string, Transform>();
  const { groupCenter, itemOffsets, itemTransforms, itemRotations } = groupState;

  for (const [id, startTransform] of itemTransforms) {
    const offset = itemOffsets.get(id)!;
    const startRotation = itemRotations.get(id)!;

    // Calculate item center in canvas coordinates
    const itemCenter: Point = {
      x: groupCenter.x + offset.x,
      y: groupCenter.y + offset.y,
    };

    // Rotate the item center around group center
    const rotatedCenter = rotatePoint(itemCenter, groupCenter, rotationDelta);

    // Convert back to transform coordinates
    const newX = rotatedCenter.x - canvasWidth / 2;
    const newY = rotatedCenter.y - canvasHeight / 2;

    // Add rotation delta to item's own rotation
    let newRotation = startRotation + rotationDelta;
    while (newRotation > 180) newRotation -= 360;
    while (newRotation < -180) newRotation += 360;

    result.set(id, {
      ...startTransform,
      x: newX,
      y: newY,
      rotation: newRotation,
    });
  }

  return result;
}

/**
 * Calculate scale factor based on corner handle drag.
 * Uses distance from group center similar to single-item scaling.
 */
export function calculateGroupScaleFactor(
  groupState: GroupTransformState,
  startPoint: Point,
  currentPoint: Point
): number {
  const { groupCenter } = groupState;

  // Calculate distances from group center
  const startDist = Math.sqrt(
    Math.pow(startPoint.x - groupCenter.x, 2) +
    Math.pow(startPoint.y - groupCenter.y, 2)
  );
  const currentDist = Math.sqrt(
    Math.pow(currentPoint.x - groupCenter.x, 2) +
    Math.pow(currentPoint.y - groupCenter.y, 2)
  );

  // Avoid division by zero
  return startDist > 0 ? currentDist / startDist : 1;
}

/**
 * Calculate rotation delta based on drag around group center.
 */
export function calculateGroupRotationDelta(
  groupState: GroupTransformState,
  startPoint: Point,
  currentPoint: Point
): number {
  const { groupCenter } = groupState;

  const startAngle = Math.atan2(
    startPoint.y - groupCenter.y,
    startPoint.x - groupCenter.x
  ) * (180 / Math.PI);

  const currentAngle = Math.atan2(
    currentPoint.y - groupCenter.y,
    currentPoint.x - groupCenter.x
  ) * (180 / Math.PI);

  return currentAngle - startAngle;
}
