import { flattenBezierPath } from '@/shared/graphics/shapes/bezier-path'
import { hasActiveTaper } from '@/shared/graphics/shapes/taper-path'
import { buildTaperedOutline, type TaperOutline } from '@/shared/graphics/shapes/taper-outline'
import type { MaskVertex } from '@/types/masks'
import type { ResolvedShapeProps } from './shape-content-props'
import type { ShapeSize } from './shape-content-layout'

/**
 * The continuous tapered-stroke outline for a custom path, or null while the
 * stroke is off or the taper values leave the width constant. Custom-path
 * taper is drawn as this outline instead of stroked segments, so an open path
 * keeps one continuous body without a wrapped start cap.
 */
export function resolvePathTaperedOutline(
  pathVertices: MaskVertex[],
  shapeProps: ResolvedShapeProps,
  layout: ShapeSize,
): TaperOutline | null {
  if (!shapeProps.strokeEnabled || !shapeProps.strokeColor) return null
  if (!hasActiveTaper(shapeProps.taper)) return null

  return buildTaperedOutline(
    flattenBezierPath(pathVertices, layout.width, layout.height, shapeProps.pathClosed),
    {
      strokeWidth: shapeProps.strokeWidth,
      lineCap: shapeProps.strokeLineCap,
      ...shapeProps.trimPath,
      ...shapeProps.taper,
    },
  )
}
