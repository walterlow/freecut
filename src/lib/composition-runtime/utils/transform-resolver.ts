import type {
  TransformProperties,
  ResolvedTransform,
  SourceDimensions,
  CanvasSettings,
} from '@/types/transform';
import type { TimelineItem, VideoItem, ImageItem } from '@/types/timeline';

/**
 * Resolve transform properties to concrete values for rendering.
 *
 * Strategy:
 * 1. If explicit values provided, use them
 * 2. Otherwise, compute "fit-to-canvas" defaults:
 *    - Scale to fit within canvas bounds (maintain aspect ratio)
 *    - Center horizontally and vertically
 *    - No rotation, full opacity
 */
export function resolveTransform(
  item: TimelineItem,
  canvas: CanvasSettings,
  sourceDimensions?: SourceDimensions
): ResolvedTransform {
  const transform = item.transform;

  // Get source dimensions (from item, parameter, or default to canvas size)
  const sourceWidth = sourceDimensions?.width ?? canvas.width;
  const sourceHeight = sourceDimensions?.height ?? canvas.height;

  // Compute fit-to-canvas scale (maintains aspect ratio)
  const scaleX = canvas.width / sourceWidth;
  const scaleY = canvas.height / sourceHeight;
  const fitScale = Math.min(scaleX, scaleY); // Fit within bounds

  // Default dimensions (fit-to-canvas)
  const defaultWidth = sourceWidth * fitScale;
  const defaultHeight = sourceHeight * fitScale;

  // Resolve each property (use explicit value or compute default)
  const width = transform?.width ?? defaultWidth;
  const height = transform?.height ?? defaultHeight;

  return {
    x: transform?.x ?? 0, // Centered (offset from center)
    y: transform?.y ?? 0,
    width,
    height,
    rotation: transform?.rotation ?? 0,
    opacity: transform?.opacity ?? 1,
    cornerRadius: transform?.cornerRadius ?? 0,
  };
}

/**
 * Get source dimensions for an item.
 * Returns undefined if dimensions are not available.
 */
export function getSourceDimensions(
  item: TimelineItem
): SourceDimensions | undefined {
  if (item.type === 'video') {
    const videoItem = item as VideoItem;
    if (videoItem.sourceWidth && videoItem.sourceHeight) {
      return { width: videoItem.sourceWidth, height: videoItem.sourceHeight };
    }
  }
  if (item.type === 'image') {
    const imageItem = item as ImageItem;
    if (imageItem.sourceWidth && imageItem.sourceHeight) {
      return { width: imageItem.sourceWidth, height: imageItem.sourceHeight };
    }
  }
  return undefined;
}

/**
 * Convert resolved transform to CSS properties for Composition rendering.
 * Positions relative to canvas center, rotates around item center.
 */
export function toTransformStyle(
  resolved: ResolvedTransform,
  canvas: CanvasSettings
): React.CSSProperties {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // Position from center: resolved.x/y is offset from center
  // This gives the top-left corner position
  const left = centerX + resolved.x - resolved.width / 2;
  const top = centerY + resolved.y - resolved.height / 2;

  // Round rotation to avoid floating point precision issues
  const rotation = Math.abs(resolved.rotation) < 0.01 ? 0 : Math.round(resolved.rotation * 100) / 100;

  return {
    position: 'absolute',
    left,
    top,
    width: resolved.width,
    height: resolved.height,
    // Rotate around center (matches gizmo behavior)
    transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: 'center center',
    opacity: resolved.opacity,
    borderRadius: resolved.cornerRadius > 0 ? resolved.cornerRadius : undefined,
    willChange: 'transform', // Hint for GPU acceleration
  };
}

/**
 * Check if an item has any transform properties set.
 */
export function hasTransformSet(item: TimelineItem): boolean {
  return item.transform !== undefined;
}

/**
 * Check if the resolved transform matches the default (fit-to-canvas).
 * Useful for determining if transform gizmos need to be shown.
 */
export function isDefaultTransform(
  resolved: ResolvedTransform,
  canvas: CanvasSettings,
  sourceDimensions?: SourceDimensions
): boolean {
  const sourceWidth = sourceDimensions?.width ?? canvas.width;
  const sourceHeight = sourceDimensions?.height ?? canvas.height;
  const scaleX = canvas.width / sourceWidth;
  const scaleY = canvas.height / sourceHeight;
  const fitScale = Math.min(scaleX, scaleY);
  const defaultWidth = sourceWidth * fitScale;
  const defaultHeight = sourceHeight * fitScale;

  return (
    resolved.x === 0 &&
    resolved.y === 0 &&
    Math.abs(resolved.width - defaultWidth) < 0.1 &&
    Math.abs(resolved.height - defaultHeight) < 0.1 &&
    resolved.rotation === 0 &&
    resolved.opacity === 1 &&
    resolved.cornerRadius === 0
  );
}

/**
 * Calculate the bounding box of a transformed item in canvas coordinates.
 * Accounts for rotation.
 */
export function getTransformBounds(
  resolved: ResolvedTransform,
  canvas: CanvasSettings
): { left: number; top: number; right: number; bottom: number } {
  const centerX = canvas.width / 2 + resolved.x;
  const centerY = canvas.height / 2 + resolved.y;
  const halfWidth = resolved.width / 2;
  const halfHeight = resolved.height / 2;

  // If no rotation, simple bounds
  if (resolved.rotation === 0) {
    return {
      left: centerX - halfWidth,
      top: centerY - halfHeight,
      right: centerX + halfWidth,
      bottom: centerY + halfHeight,
    };
  }

  // With rotation, calculate rotated corners
  const rad = (resolved.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Corner offsets from center
  const corners = [
    { dx: -halfWidth, dy: -halfHeight },
    { dx: halfWidth, dy: -halfHeight },
    { dx: halfWidth, dy: halfHeight },
    { dx: -halfWidth, dy: halfHeight },
  ];

  // Rotate corners and find bounds
  const rotatedCorners = corners.map(({ dx, dy }) => ({
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  }));

  return {
    left: Math.min(...rotatedCorners.map((c) => c.x)),
    top: Math.min(...rotatedCorners.map((c) => c.y)),
    right: Math.max(...rotatedCorners.map((c) => c.x)),
    bottom: Math.max(...rotatedCorners.map((c) => c.y)),
  };
}
