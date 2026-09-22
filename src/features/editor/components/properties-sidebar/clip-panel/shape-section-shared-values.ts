import type { ShapeItem, ShapeStyleFields } from '@/types/timeline'
import {
  DEFAULT_SHAPE_GRADIENT_ANGLE,
  DEFAULT_SHAPE_GRADIENT_END_COLOR,
} from '@/shared/graphics/shapes/linear-gradient'

/** A value that every selected shape agrees on, or `'mixed'` when they differ. */
export type SharedShapeValue<T> = T | 'mixed'

/**
 * Values shared by the whole shape selection, as the inspector shows them.
 * `undefined` marks a disagreement for enum-like fields so the control falls
 * back to its placeholder; numeric/boolean fields use `'mixed'`.
 */
export interface ShapeSharedValues {
  shapeType: ShapeItem['shapeType'] | undefined
  fillColor: string | undefined
  fillEnabled: SharedShapeValue<boolean>
  fillType: ShapeStyleFields['fillType']
  gradientStartColor: string | undefined
  gradientEndColor: string | undefined
  gradientAngle: SharedShapeValue<number>
  strokeColor: string | undefined
  strokeWidth: SharedShapeValue<number>
  strokeEnabled: SharedShapeValue<boolean>
  strokeLineCap: ShapeStyleFields['strokeLineCap']
  strokeLineJoin: ShapeStyleFields['strokeLineJoin']
  strokeMiterLimit: SharedShapeValue<number>
  cornerRadius: SharedShapeValue<number>
  direction: ShapeItem['direction']
  points: SharedShapeValue<number>
  innerRadius: SharedShapeValue<number>
  trimPathStart: SharedShapeValue<number>
  trimPathEnd: SharedShapeValue<number>
  trimPathOffset: SharedShapeValue<number>
  taperStartWidth: SharedShapeValue<number>
  taperEndWidth: SharedShapeValue<number>
  taperStartLength: SharedShapeValue<number>
  taperEndLength: SharedShapeValue<number>
  pathClosed: SharedShapeValue<boolean>
  isMask: SharedShapeValue<boolean>
  maskType: ShapeItem['maskType']
  maskFeather: SharedShapeValue<number>
  maskOpacity: SharedShapeValue<number>
  maskInvert: SharedShapeValue<boolean>
}

/**
 * Reads the same property from every shape and keeps it only while all of them
 * still agree; the first disagreement yields `fallback`.
 */
function readSharedValue<TValue, TFallback>(
  shapes: ShapeItem[],
  read: (shape: ShapeItem) => TValue,
  fallback: TFallback,
): TValue | TFallback {
  const first = read(shapes[0]!)
  for (let index = 1; index < shapes.length; index += 1) {
    if (read(shapes[index]!) !== first) return fallback
  }
  return first
}

/** Shared shape values for the selection, or `null` when nothing is selected. */
export function getSharedShapeValues(shapes: ShapeItem[]): ShapeSharedValues | null {
  if (shapes.length === 0) return null

  return {
    shapeType: readSharedValue(shapes, (shape) => shape.shapeType, undefined),
    fillColor: readSharedValue(shapes, (shape) => shape.fillColor, undefined),
    fillEnabled: readSharedValue(shapes, (shape) => shape.fillEnabled ?? true, 'mixed' as const),
    fillType: readSharedValue(shapes, (shape) => shape.fillType ?? 'solid', undefined),
    gradientStartColor: readSharedValue(
      shapes,
      (shape) => shape.gradientStartColor ?? shape.fillColor,
      undefined,
    ),
    gradientEndColor: readSharedValue(
      shapes,
      (shape) => shape.gradientEndColor ?? DEFAULT_SHAPE_GRADIENT_END_COLOR,
      undefined,
    ),
    gradientAngle: readSharedValue(
      shapes,
      (shape) => shape.gradientAngle ?? DEFAULT_SHAPE_GRADIENT_ANGLE,
      'mixed' as const,
    ),
    strokeColor: readSharedValue(shapes, (shape) => shape.strokeColor ?? '', undefined),
    strokeWidth: readSharedValue(shapes, (shape) => shape.strokeWidth ?? 0, 'mixed' as const),
    strokeEnabled: readSharedValue(
      shapes,
      (shape) => shape.strokeEnabled ?? ((shape.strokeWidth ?? 0) > 0 && !!shape.strokeColor),
      'mixed' as const,
    ),
    strokeLineCap: readSharedValue(shapes, (shape) => shape.strokeLineCap ?? 'butt', undefined),
    strokeLineJoin: readSharedValue(shapes, (shape) => shape.strokeLineJoin ?? 'miter', undefined),
    strokeMiterLimit: readSharedValue(
      shapes,
      (shape) => shape.strokeMiterLimit ?? 4,
      'mixed' as const,
    ),
    cornerRadius: readSharedValue(shapes, (shape) => shape.cornerRadius ?? 0, 'mixed' as const),
    direction: readSharedValue(shapes, (shape) => shape.direction ?? 'up', undefined),
    points: readSharedValue(shapes, (shape) => shape.points ?? 5, 'mixed' as const),
    innerRadius: readSharedValue(shapes, (shape) => shape.innerRadius ?? 0.5, 'mixed' as const),
    trimPathStart: readSharedValue(shapes, (shape) => shape.trimPathStart ?? 0, 'mixed' as const),
    trimPathEnd: readSharedValue(shapes, (shape) => shape.trimPathEnd ?? 100, 'mixed' as const),
    trimPathOffset: readSharedValue(shapes, (shape) => shape.trimPathOffset ?? 0, 'mixed' as const),
    taperStartWidth: readSharedValue(
      shapes,
      (shape) => shape.taperStartWidth ?? 100,
      'mixed' as const,
    ),
    taperEndWidth: readSharedValue(shapes, (shape) => shape.taperEndWidth ?? 100, 'mixed' as const),
    taperStartLength: readSharedValue(
      shapes,
      (shape) => shape.taperStartLength ?? 0,
      'mixed' as const,
    ),
    taperEndLength: readSharedValue(shapes, (shape) => shape.taperEndLength ?? 0, 'mixed' as const),
    pathClosed: readSharedValue(shapes, (shape) => shape.pathClosed ?? true, 'mixed' as const),
    isMask: readSharedValue(shapes, (shape) => shape.isMask ?? false, 'mixed' as const),
    maskType: readSharedValue(shapes, (shape) => shape.maskType ?? 'clip', undefined),
    maskFeather: readSharedValue(shapes, (shape) => shape.maskFeather ?? 10, 'mixed' as const),
    maskOpacity: readSharedValue(shapes, (shape) => shape.maskOpacity ?? 100, 'mixed' as const),
    maskInvert: readSharedValue(shapes, (shape) => shape.maskInvert ?? false, 'mixed' as const),
  }
}
