import type { ShapeItem } from '@/types/timeline';
import {
  makeRect,
  makeCircle,
  makeTriangle,
  makeEllipse,
  makeStar,
  makePolygon,
  makeHeart,
} from '@/shared/graphics/shapes/shape-generators';
import {
  scalePath,
  translatePath,
} from '@/shared/graphics/shapes/path-utils';

/**
 * Generates SVG path data for shape items using Composition's shape utilities.
 * This ensures mask paths match exactly how shapes are rendered in ShapeContent.
 * Uses @legacy-video/shapes for path generation and @legacy-video/paths for transformations.
 */

interface ShapePathOptions {
  /** Canvas width for coordinate calculations */
  canvasWidth: number;
  /** Canvas height for coordinate calculations */
  canvasHeight: number;
  /** Whether aspect ratio is locked (default: true) - affects centering behavior */
  aspectLocked?: boolean;
}

interface ShapeTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  cornerRadius?: number;
  aspectRatioLocked?: boolean;
}

/**
 * Get the SVG path string for a shape at its transform position.
 * Returns a path that can be used in clipPath or mask elements.
 *
 * The path generation matches ShapeContent rendering:
 * - When aspectLocked (default): Shape renders at baseSize and is CENTERED in container via flexbox
 * - When !aspectLocked: Shape is scaled to fill full width/height
 * - Rectangle/Ellipse: Always use full width/height (naturally support non-proportional)
 */
export function getShapePath(
  shape: ShapeItem,
  transform: ShapeTransform,
  options: ShapePathOptions
): string {
  const { canvasWidth, canvasHeight } = options;
  // Default to locked (matches ShapeContent default behavior)
  const aspectLocked = options.aspectLocked ?? (shape.transform?.aspectRatioLocked ?? true);

  // Calculate canvas position (transform.x/y are relative to center)
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  const width = transform.width;
  const height = transform.height;
  const cornerRadius = shape.cornerRadius ?? 0;

  // Calculate the bounding box top-left on canvas
  const boxLeft = centerX + transform.x - width / 2;
  const boxTop = centerY + transform.y - height / 2;

  // baseSize for shapes that use it (matching ShapeContent)
  const baseSize = Math.min(width, height);

  let path: string;

  switch (shape.shapeType) {
    case 'rectangle': {
      // Rectangle uses full width/height directly (no baseSize/centering)
      const result = makeRect({ width, height, cornerRadius });
      path = translatePath(result.path, boxLeft, boxTop);
      break;
    }

    case 'circle': {
      const radius = baseSize / 2;
      const result = makeCircle({ radius });
      // Circle: generated size is diameter x diameter (square)
      const shapeWidth = result.width;
      const shapeHeight = result.height;

      if (aspectLocked) {
        // Flexbox centers the shape within the container
        const offsetX = (width - shapeWidth) / 2;
        const offsetY = (height - shapeHeight) / 2;
        path = translatePath(result.path, boxLeft + offsetX, boxTop + offsetY);
      } else {
        // Scale to fill full container
        const scaleX = width / shapeWidth;
        const scaleY = height / shapeHeight;
        const scaledPath = scalePath(result.path, scaleX, scaleY);
        path = translatePath(scaledPath, boxLeft, boxTop);
      }
      break;
    }

    case 'ellipse': {
      // Ellipse uses full width/height via rx/ry (no baseSize/centering)
      const rx = width / 2;
      const ry = height / 2;
      const result = makeEllipse({ rx, ry });
      path = translatePath(result.path, boxLeft, boxTop);
      break;
    }

    case 'triangle': {
      const direction = shape.direction ?? 'up';
      const result = makeTriangle({ length: baseSize, direction, cornerRadius });
      // Triangle: generated size depends on direction (equilateral)
      // Up/Down: width=length, height=length*sqrt(3)/2
      // Left/Right: width=length*sqrt(3)/2, height=length
      const shapeWidth = result.width;
      const shapeHeight = result.height;

      if (aspectLocked) {
        // Flexbox centers the shape within the container
        const offsetX = (width - shapeWidth) / 2;
        const offsetY = (height - shapeHeight) / 2;
        path = translatePath(result.path, boxLeft + offsetX, boxTop + offsetY);
      } else {
        // Scale to fill full container
        const scaleX = width / shapeWidth;
        const scaleY = height / shapeHeight;
        const scaledPath = scalePath(result.path, scaleX, scaleY);
        path = translatePath(scaledPath, boxLeft, boxTop);
      }
      break;
    }

    case 'star': {
      const outerRadius = baseSize / 2;
      const innerRadiusRatio = shape.innerRadius ?? 0.5;
      const innerRadius = outerRadius * innerRadiusRatio;
      const points = shape.points ?? 5;

      const result = makeStar({
        points,
        outerRadius,
        innerRadius,
        cornerRadius,
      });
      // Star: generated size is diameter x diameter (square)
      const shapeWidth = result.width;
      const shapeHeight = result.height;

      if (aspectLocked) {
        // Flexbox centers the shape within the container
        const offsetX = (width - shapeWidth) / 2;
        const offsetY = (height - shapeHeight) / 2;
        path = translatePath(result.path, boxLeft + offsetX, boxTop + offsetY);
      } else {
        // Scale to fill full container
        const scaleX = width / shapeWidth;
        const scaleY = height / shapeHeight;
        const scaledPath = scalePath(result.path, scaleX, scaleY);
        path = translatePath(scaledPath, boxLeft, boxTop);
      }
      break;
    }

    case 'polygon': {
      const radius = baseSize / 2;
      const points = shape.points ?? 6;

      const result = makePolygon({ points, radius, cornerRadius });
      // Polygon: generated size depends on number of points
      const shapeWidth = result.width;
      const shapeHeight = result.height;

      if (aspectLocked) {
        // Flexbox centers the shape within the container
        const offsetX = (width - shapeWidth) / 2;
        const offsetY = (height - shapeHeight) / 2;
        path = translatePath(result.path, boxLeft + offsetX, boxTop + offsetY);
      } else {
        // Scale to fill full container
        const scaleX = width / shapeWidth;
        const scaleY = height / shapeHeight;
        const scaledPath = scalePath(result.path, scaleX, scaleY);
        path = translatePath(scaledPath, boxLeft, boxTop);
      }
      break;
    }

    case 'heart': {
      // Use Composition's makeHeart for consistent path generation
      // Heart output width = 1.1 Ã— input height, so we scale input to fit within baseSize
      // Using height = baseSize / 1.1 ensures output width = baseSize (matches ShapeContent)
      const heartHeight = baseSize / 1.1;
      const result = makeHeart({ height: heartHeight });
      const shapeWidth = result.width;
      const shapeHeight = result.height;

      if (aspectLocked) {
        // Flexbox centers the shape within the container
        const offsetX = (width - shapeWidth) / 2;
        const offsetY = (height - shapeHeight) / 2;
        path = translatePath(result.path, boxLeft + offsetX, boxTop + offsetY);
      } else {
        // Scale to fill full container
        const scaleX = width / shapeWidth;
        const scaleY = height / shapeHeight;
        const scaledPath = scalePath(result.path, scaleX, scaleY);
        path = translatePath(scaledPath, boxLeft, boxTop);
      }
      break;
    }

    default: {
      // Fallback to rectangle
      const fallbackResult = makeRect({ width, height, cornerRadius: 0 });
      path = translatePath(fallbackResult.path, boxLeft, boxTop);
      break;
    }
  }

  return path;
}

/**
 * Rotate a path around a center point.
 * Parses the path, rotates all coordinates, and returns a new path string.
 * This bakes the rotation into the path coordinates for CSS clip-path compatibility.
 */
export function rotatePath(
  pathString: string,
  angleDegrees: number,
  centerX: number,
  centerY: number
): string {
  if (!angleDegrees || angleDegrees === 0) {
    return pathString;
  }

  const angleRadians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);

  // Rotate a point around the center
  const rotatePoint = (x: number, y: number): [number, number] => {
    const dx = x - centerX;
    const dy = y - centerY;
    return [
      centerX + dx * cos - dy * sin,
      centerY + dx * sin + dy * cos,
    ];
  };

  // Parse and transform the path
  // This is a simplified parser that handles M, L, C, A, Z commands
  const result: string[] = [];
  const commands = pathString.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) || [];

  for (const cmd of commands) {
    const type = cmd[0]!.toUpperCase();
    const args = cmd.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));

    switch (type) {
      case 'M':
      case 'L': {
        // Move/Line: x y
        for (let i = 0; i < args.length; i += 2) {
          const [rx, ry] = rotatePoint(args[i]!, args[i + 1]!);
          result.push(`${i === 0 ? type : 'L'} ${rx} ${ry}`);
        }
        break;
      }
      case 'H': {
        // Horizontal line - convert to L with current y (simplified: assume y=centerY)
        const [rx, ry] = rotatePoint(args[0]!, centerY);
        result.push(`L ${rx} ${ry}`);
        break;
      }
      case 'V': {
        // Vertical line - convert to L with current x (simplified: assume x=centerX)
        const [rx, ry] = rotatePoint(centerX, args[0]!);
        result.push(`L ${rx} ${ry}`);
        break;
      }
      case 'C': {
        // Cubic bezier: x1 y1 x2 y2 x y
        for (let i = 0; i < args.length; i += 6) {
          const [rx1, ry1] = rotatePoint(args[i]!, args[i + 1]!);
          const [rx2, ry2] = rotatePoint(args[i + 2]!, args[i + 3]!);
          const [rx, ry] = rotatePoint(args[i + 4]!, args[i + 5]!);
          result.push(`C ${rx1} ${ry1} ${rx2} ${ry2} ${rx} ${ry}`);
        }
        break;
      }
      case 'Q': {
        // Quadratic bezier: x1 y1 x y
        for (let i = 0; i < args.length; i += 4) {
          const [rx1, ry1] = rotatePoint(args[i]!, args[i + 1]!);
          const [rx, ry] = rotatePoint(args[i + 2]!, args[i + 3]!);
          result.push(`Q ${rx1} ${ry1} ${rx} ${ry}`);
        }
        break;
      }
      case 'A': {
        // Arc: rx ry x-axis-rotation large-arc sweep x y
        // For arcs, we rotate the endpoint and adjust the x-axis-rotation
        for (let i = 0; i < args.length; i += 7) {
          const [rx, ry] = rotatePoint(args[i + 5]!, args[i + 6]!);
          const newXAxisRotation = (args[i + 2]! + angleDegrees) % 360;
          result.push(`A ${args[i]} ${args[i + 1]} ${newXAxisRotation} ${args[i + 3]} ${args[i + 4]} ${rx} ${ry}`);
        }
        break;
      }
      case 'Z': {
        result.push('Z');
        break;
      }
      default: {
        // Pass through unknown commands
        result.push(cmd);
      }
    }
  }

  return result.join(' ');
}

