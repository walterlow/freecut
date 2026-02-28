/**
 * Canvas Shape Rendering System
 *
 * Renders all shape types with full styling support for client-side export.
 * Leverages existing shape-path utilities and converts SVG paths to Path2D.
 */

import type { ShapeItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { getShapePath, rotatePath } from '@/features/export/deps/composition-runtime';
import { svgPathToPath2D } from './canvas-masks';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('CanvasShapes');

/**
 * Canvas dimensions for shape rendering
 */
interface ShapeCanvasSettings {
  width: number;
  height: number;
}

/**
 * Get a Path2D for a shape at its current transform.
 *
 * @param shape - The shape item
 * @param transform - Resolved transform (possibly animated)
 * @param canvas - Canvas dimensions
 * @returns Path2D ready for canvas rendering
 */
function getShapePath2D(
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

