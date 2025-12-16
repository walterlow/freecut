/**
 * Canvas Shape Rendering System
 *
 * Renders all shape types with full styling support for client-side export.
 * Leverages existing shape-path utilities and converts SVG paths to Path2D.
 */

import type { ShapeItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { getShapePath, rotatePath } from '@/lib/remotion/utils/shape-path';
import { createLogger } from '@/lib/logger';

const log = createLogger('CanvasShapes');

/**
 * Canvas dimensions for shape rendering
 */
export interface ShapeCanvasSettings {
  width: number;
  height: number;
}

/**
 * Convert an SVG path string to a Path2D object.
 * Path2D natively supports SVG path data strings.
 */
export function svgPathToPath2D(svgPath: string): Path2D {
  return new Path2D(svgPath);
}

/**
 * Get a Path2D for a shape at its current transform.
 *
 * @param shape - The shape item
 * @param transform - Resolved transform (possibly animated)
 * @param canvas - Canvas dimensions
 * @returns Path2D ready for canvas rendering
 */
export function getShapePath2D(
  shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings
): Path2D {
  // Use existing shape-path utility to generate SVG path
  const svgPath = getShapePath(
    shape,
    {
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: 0, // Rotation handled separately
      opacity: transform.opacity,
    },
    {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    }
  );

  // Apply rotation by baking it into the path coordinates
  let finalPath = svgPath;
  if (transform.rotation !== 0) {
    const centerX = canvas.width / 2 + transform.x;
    const centerY = canvas.height / 2 + transform.y;
    finalPath = rotatePath(svgPath, transform.rotation, centerX, centerY);
  }

  return svgPathToPath2D(finalPath);
}

/**
 * Render a shape item to canvas.
 *
 * @param ctx - Canvas 2D context
 * @param shape - The shape item to render
 * @param transform - Resolved transform (possibly animated)
 * @param canvas - Canvas dimensions
 */
export function renderShape(
  ctx: OffscreenCanvasRenderingContext2D,
  shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings
): void {
  // Don't render masks as shapes - they're handled by the mask system
  if (shape.isMask) return;

  ctx.save();

  try {
    // Get the shape path
    const path = getShapePath2D(shape, transform, canvas);

    // Apply opacity
    ctx.globalAlpha = transform.opacity;

    // Fill the shape
    if (shape.fillColor) {
      ctx.fillStyle = shape.fillColor;
      ctx.fill(path);
    }

    // Stroke the shape
    if (shape.strokeWidth && shape.strokeWidth > 0 && shape.strokeColor) {
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.stroke(path);
    }

    // Apply corner radius clipping if needed
    if (transform.cornerRadius > 0) {
      // Note: Corner radius is typically baked into the shape path
      // for rectangles. For other shapes, it's handled by the shape generator.
      log.debug('Corner radius applied via shape path', {
        shapeId: shape.id,
        cornerRadius: transform.cornerRadius,
      });
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Render a shape with gradient fill (if supported in future).
 * Currently renders solid fill with warning.
 */
export function renderShapeWithGradient(
  ctx: OffscreenCanvasRenderingContext2D,
  shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings,
  gradientType: 'linear' | 'radial',
  gradientStops: Array<{ offset: number; color: string }>
): void {
  ctx.save();

  try {
    const path = getShapePath2D(shape, transform, canvas);

    // Calculate gradient bounds
    const centerX = canvas.width / 2 + transform.x;
    const centerY = canvas.height / 2 + transform.y;
    const halfWidth = transform.width / 2;
    const halfHeight = transform.height / 2;

    let gradient: CanvasGradient;

    if (gradientType === 'linear') {
      gradient = ctx.createLinearGradient(
        centerX - halfWidth,
        centerY,
        centerX + halfWidth,
        centerY
      );
    } else {
      gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.max(halfWidth, halfHeight)
      );
    }

    // Add color stops
    for (const stop of gradientStops) {
      gradient.addColorStop(stop.offset, stop.color);
    }

    ctx.fillStyle = gradient;
    ctx.globalAlpha = transform.opacity;
    ctx.fill(path);

    // Stroke if needed
    if (shape.strokeWidth && shape.strokeWidth > 0 && shape.strokeColor) {
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.stroke(path);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Check if a shape type is supported for canvas rendering.
 */
export function isShapeTypeSupported(shapeType: string): boolean {
  const supportedTypes = [
    'rectangle',
    'circle',
    'ellipse',
    'triangle',
    'star',
    'polygon',
    'heart',
  ];
  return supportedTypes.includes(shapeType);
}

/**
 * Get shape bounds for hit testing or clipping.
 */
export function getShapeBounds(
  _shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings
): { left: number; top: number; right: number; bottom: number } {
  const centerX = canvas.width / 2 + transform.x;
  const centerY = canvas.height / 2 + transform.y;
  const halfWidth = transform.width / 2;
  const halfHeight = transform.height / 2;

  // For rotated shapes, calculate bounding box
  if (transform.rotation !== 0) {
    const rad = (transform.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));

    // Rotated bounding box dimensions
    const rotatedHalfWidth = halfWidth * cos + halfHeight * sin;
    const rotatedHalfHeight = halfWidth * sin + halfHeight * cos;

    return {
      left: centerX - rotatedHalfWidth,
      top: centerY - rotatedHalfHeight,
      right: centerX + rotatedHalfWidth,
      bottom: centerY + rotatedHalfHeight,
    };
  }

  return {
    left: centerX - halfWidth,
    top: centerY - halfHeight,
    right: centerX + halfWidth,
    bottom: centerY + halfHeight,
  };
}
