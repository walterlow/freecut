import type { GizmoState, GizmoHandle, Transform, Point } from '../types/gizmo';
import { rotatePoint, getAngleFromCenter } from './coordinate-transform';

const MIN_SIZE = 20;

/**
 * Calculate new transform based on current gizmo interaction.
 * @param cornerAnchored - When true, scaling anchors from opposite corner instead of center (Ctrl key)
 */
export function calculateTransform(
  gizmo: GizmoState,
  currentPoint: Point,
  shiftKey: boolean,
  canvasWidth: number,
  canvasHeight: number,
  cornerAnchored: boolean = false
): Transform {
  switch (gizmo.mode) {
    case 'translate':
      return calculateTranslation(gizmo.startTransform, gizmo.startPoint, currentPoint);
    case 'scale':
      return calculateScale(
        gizmo.startTransform,
        gizmo.activeHandle!,
        gizmo.startPoint,
        currentPoint,
        !shiftKey, // Locked aspect ratio when shift NOT pressed
        canvasWidth,
        canvasHeight,
        cornerAnchored
      );
    case 'rotate':
      return calculateRotation(
        gizmo.startTransform,
        gizmo.startPoint,
        currentPoint,
        canvasWidth,
        canvasHeight
      );
    default:
      return gizmo.startTransform;
  }
}

/**
 * Calculate translation (drag to move).
 * Note: Values are NOT rounded here - rounding happens in snap functions.
 */
function calculateTranslation(
  start: Transform,
  startPoint: Point,
  currentPoint: Point
): Transform {
  return {
    ...start,
    x: start.x + (currentPoint.x - startPoint.x),
    y: start.y + (currentPoint.y - startPoint.y),
  };
}

/**
 * Calculate scale based on handle drag.
 * By default, scaling is center-anchored (center stays fixed).
 * When cornerAnchored is true (Ctrl held), the opposite corner/edge stays fixed.
 * Handles maintain aspect ratio unless shift is held.
 */
function calculateScale(
  start: Transform,
  handle: GizmoHandle,
  startPoint: Point,
  currentPoint: Point,
  maintainAspectRatio: boolean,
  canvasWidth: number,
  canvasHeight: number,
  cornerAnchored: boolean = false
): Transform {
  // Get center of the item in canvas coordinates
  const centerX = canvasWidth / 2 + start.x;
  const centerY = canvasHeight / 2 + start.y;
  const center: Point = { x: centerX, y: centerY };

  // Work in local (unrotated) space for scale calculations
  const localStart = rotatePoint(startPoint, center, -start.rotation);
  const localCurrent = rotatePoint(currentPoint, center, -start.rotation);

  // Determine which edges are affected
  const affectsLeft = handle.includes('w');
  const affectsRight = handle.includes('e');
  const affectsTop = handle.includes('n');
  const affectsBottom = handle.includes('s');
  const isCornerHandle = (affectsLeft || affectsRight) && (affectsTop || affectsBottom);

  let newWidth: number;
  let newHeight: number;
  let newX = start.x;
  let newY = start.y;

  if (maintainAspectRatio && isCornerHandle) {
    // For corner handles with aspect ratio lock, use scale factor approach
    // This prevents direction flipping by using distance from center
    if (cornerAnchored) {
      // Corner-anchored: use distance from anchor point (opposite corner)
      // Anchor is opposite corner in local coordinates
      const anchorX = affectsRight ? centerX - start.width / 2 : centerX + start.width / 2;
      const anchorY = affectsBottom ? centerY - start.height / 2 : centerY + start.height / 2;

      const startDist = Math.sqrt(
        Math.pow(localStart.x - anchorX, 2) + Math.pow(localStart.y - anchorY, 2)
      );
      const currentDist = Math.sqrt(
        Math.pow(localCurrent.x - anchorX, 2) + Math.pow(localCurrent.y - anchorY, 2)
      );

      const scaleFactor = startDist > 0 ? currentDist / startDist : 1;
      newWidth = Math.max(MIN_SIZE, start.width * scaleFactor);
      newHeight = Math.max(MIN_SIZE, start.height * scaleFactor);

      // Adjust position to keep anchor fixed
      const widthDiff = newWidth - start.width;
      const heightDiff = newHeight - start.height;
      newX = affectsRight ? start.x + widthDiff / 2 : start.x - widthDiff / 2;
      newY = affectsBottom ? start.y + heightDiff / 2 : start.y - heightDiff / 2;
    } else {
      // Center-anchored (default): use distance from center
      const startDist = Math.sqrt(
        Math.pow(localStart.x - centerX, 2) + Math.pow(localStart.y - centerY, 2)
      );
      const currentDist = Math.sqrt(
        Math.pow(localCurrent.x - centerX, 2) + Math.pow(localCurrent.y - centerY, 2)
      );

      const scaleFactor = startDist > 0 ? currentDist / startDist : 1;
      newWidth = Math.max(MIN_SIZE, start.width * scaleFactor);
      newHeight = Math.max(MIN_SIZE, start.height * scaleFactor);
    }
  } else {
    // Edge handles or free scaling (shift held)
    const dx = localCurrent.x - localStart.x;
    const dy = localCurrent.y - localStart.y;

    // Calculate width/height deltas based on handle
    // For center-anchored: multiply by 2 since we scale from center
    // For corner-anchored: multiply by 1 since only one side moves
    const multiplier = cornerAnchored ? 1 : 2;
    let widthDelta = 0;
    let heightDelta = 0;

    if (affectsRight) {
      widthDelta = dx * multiplier;
    } else if (affectsLeft) {
      widthDelta = -dx * multiplier;
    }

    if (affectsBottom) {
      heightDelta = dy * multiplier;
    } else if (affectsTop) {
      heightDelta = -dy * multiplier;
    }

    newWidth = Math.max(MIN_SIZE, start.width + widthDelta);
    newHeight = Math.max(MIN_SIZE, start.height + heightDelta);

    // Maintain aspect ratio for edge handles
    if (maintainAspectRatio) {
      const aspectRatio = start.width / start.height;
      const isHorizontalEdge = (affectsLeft || affectsRight) && !(affectsTop || affectsBottom);

      if (isHorizontalEdge) {
        newHeight = newWidth / aspectRatio;
      } else {
        newWidth = newHeight * aspectRatio;
      }
    }

    // For corner-anchored scaling, adjust position to keep opposite edge/corner fixed
    if (cornerAnchored) {
      const widthDiff = newWidth - start.width;
      const heightDiff = newHeight - start.height;

      // Shift center to maintain anchor point
      // When dragging right handles, anchor is on left, so center shifts right
      // When dragging left handles, anchor is on right, so center shifts left
      if (affectsRight) {
        newX = start.x + widthDiff / 2;
      } else if (affectsLeft) {
        newX = start.x - widthDiff / 2;
      }

      if (affectsBottom) {
        newY = start.y + heightDiff / 2;
      } else if (affectsTop) {
        newY = start.y - heightDiff / 2;
      }
    }
  }

  // Note: Values are NOT rounded here - rounding happens in snap functions
  return {
    ...start,
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Calculate rotation based on drag around center.
 */
function calculateRotation(
  start: Transform,
  startPoint: Point,
  currentPoint: Point,
  canvasWidth: number,
  canvasHeight: number
): Transform {
  // Get center in canvas coordinates
  const centerX = canvasWidth / 2 + start.x;
  const centerY = canvasHeight / 2 + start.y;
  const center: Point = { x: centerX, y: centerY };

  // Calculate angle change
  const startAngle = getAngleFromCenter(startPoint, center);
  const currentAngle = getAngleFromCenter(currentPoint, center);
  const deltaAngle = currentAngle - startAngle;

  // Normalize rotation to -180 to 180 range
  let newRotation = start.rotation + deltaAngle;
  while (newRotation > 180) newRotation -= 360;
  while (newRotation < -180) newRotation += 360;

  return {
    ...start,
    rotation: newRotation,
  };
}
