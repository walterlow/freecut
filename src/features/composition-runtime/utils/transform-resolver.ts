import type {
  ResolvedTransform,
  SourceDimensions,
  CanvasSettings,
} from '@/types/transform';
import type { TimelineItem, VideoItem, ImageItem, CompositionItem } from '@/types/timeline';

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
  if (item.type === 'composition') {
    const compItem = item as CompositionItem;
    if (compItem.compositionWidth && compItem.compositionHeight) {
      return { width: compItem.compositionWidth, height: compItem.compositionHeight };
    }
    return undefined;
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
