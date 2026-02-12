import type { Point, CoordinateParams, Transform } from '../types/gizmo';

// Default handle size for gizmo controls
export const HANDLE_SIZE = 8;
export const ROTATION_HANDLE_OFFSET = 24;

/**
 * Calculate the effective scale from zoom level.
 * When zoom is -1 (auto-fit), calculate based on container/project ratio.
 */
export function getEffectiveScale(params: CoordinateParams): number {
  const { playerSize, projectSize, zoom } = params;

  if (zoom === -1) {
    // Auto-fit: scale to fit project within player
    return Math.min(
      playerSize.width / projectSize.width,
      playerSize.height / projectSize.height
    );
  }

  return zoom;
}

/**
 * Convert screen coordinates (from mouse events) to canvas coordinates.
 * Accounts for: container position, player centering, zoom level.
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  params: CoordinateParams
): Point {
  const { containerRect, playerSize } = params;
  const scale = getEffectiveScale(params);

  // Calculate player position within container (centered)
  const playerOffsetX = (containerRect.width - playerSize.width) / 2;
  const playerOffsetY = (containerRect.height - playerSize.height) / 2;

  // Convert screen to player space
  const playerX = screenX - containerRect.left - playerOffsetX;
  const playerY = screenY - containerRect.top - playerOffsetY;

  // Convert player to canvas space
  return {
    x: playerX / scale,
    y: playerY / scale,
  };
}

/**
 * Rotate a point around a center point.
 */
export function rotatePoint(
  point: Point,
  center: Point,
  angleDegrees: number
): Point {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Get the center point of a transform.
 * Transform x/y is offset from canvas center, so we need to calculate actual center.
 */
export function getTransformCenter(
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number
): Point {
  return {
    x: canvasWidth / 2 + transform.x,
    y: canvasHeight / 2 + transform.y,
  };
}

/**
 * Convert transform bounds to screen rectangle.
 * Used for positioning the gizmo overlay.
 */
export function transformToScreenBounds(
  transform: Transform,
  params: CoordinateParams
): { left: number; top: number; width: number; height: number } {
  const { projectSize } = params;
  const scale = getEffectiveScale(params);

  // Transform x/y is offset from canvas center
  const canvasCenterX = projectSize.width / 2;
  const canvasCenterY = projectSize.height / 2;

  // Top-left corner in canvas space
  const canvasLeft = canvasCenterX + transform.x - transform.width / 2;
  const canvasTop = canvasCenterY + transform.y - transform.height / 2;

  // Convert to screen space relative to player
  return {
    left: canvasLeft * scale,
    top: canvasTop * scale,
    width: transform.width * scale,
    height: transform.height * scale,
  };
}

/**
 * Calculate angle in degrees from center to a point.
 */
export function getAngleFromCenter(point: Point, center: Point): number {
  return Math.atan2(point.y - center.y, point.x - center.x) * (180 / Math.PI);
}

/**
 * Get cursor style for a scale handle based on item rotation.
 * Cursors need to rotate with the item.
 */
export function getScaleCursor(
  handle: string,
  rotation: number
): string {
  // Base angles for each handle direction
  const baseAngles: Record<string, number> = {
    e: 0,
    se: 45,
    s: 90,
    sw: 135,
    w: 180,
    nw: 225,
    n: 270,
    ne: 315,
  };

  const baseAngle = baseAngles[handle] ?? 0;
  const adjustedAngle = (baseAngle + rotation + 360) % 360;

  // Map angle to cursor (every 45 degrees cycles through 4 cursor types)
  const cursorIndex = Math.round(adjustedAngle / 45) % 4;
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

  return cursors[cursorIndex] ?? 'default';
}
