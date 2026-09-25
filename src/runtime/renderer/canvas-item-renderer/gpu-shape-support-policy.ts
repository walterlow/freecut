/**
 * Pure support policy for the GPU shape pipeline (`gpu.ts`): the canvas-space
 * vertices the shape shader consumes for an authored bezier path, and why a
 * shape cannot be drawn by that pipeline at all. Nothing here touches a
 * `GPUTexture`, a pipeline or a render context, so the flatten / closure-trim /
 * resample ladder and the rejection ladder can be unit tested without a device;
 * texture uploads and the pipeline calls stay in `gpu.ts`.
 */

import type { ShapeItem } from '@/types/timeline'
import type { FlattenedPathPoint } from '@/shared/graphics/shapes/bezier-path'
import { flattenBezierPath } from '@/shared/graphics/shapes/bezier-path'
import { resolveShapeLinearGradient } from '@/shared/graphics/shapes/linear-gradient'
import { MAX_GPU_SHAPE_PATH_VERTICES } from '@/infrastructure/gpu-shapes'
import { isGpuShapeFillEnabled, parseGpuColor } from './gpu-participant-policy'
import type { ItemTransform } from './types'

/** One shader vertex: canvas-centred x/y plus the progress the taper metrics read. */
export type GpuShapePathVertex = [number, number, number?]

/**
 * A closed contour repeats its first point at progress 1; the shader wants the
 * distinct vertices only.
 */
function trimGpuShapePathClosure(
  points: FlattenedPathPoint[],
  closed: boolean,
): FlattenedPathPoint[] {
  if (!closed) return points
  if (points.length <= 1) return points
  if (points.at(-1)?.progress !== 1) return points
  return points.slice(0, -1)
}

/**
 * Interpolates the flattened path at an arbitrary progress: a path carrying more
 * points than the shader accepts is resampled uniformly, so its samples land
 * between two flattened points. Flattened points are laid out in path space, the
 * shader consumes canvas-centred space.
 */
function sampleGpuShapePathAtProgress(
  metricPoints: FlattenedPathPoint[],
  transform: ItemTransform,
  progress: number,
): GpuShapePathVertex {
  const offsetX = transform.width / 2
  const offsetY = transform.height / 2
  const nextIndex = metricPoints.findIndex((point) => point.progress >= progress)
  if (nextIndex <= 0) {
    const point = metricPoints[0]!
    return [point.x - offsetX, point.y - offsetY, progress]
  }
  const previous = metricPoints[nextIndex - 1]!
  const next = metricPoints[nextIndex]!
  const span = Math.max(next.progress - previous.progress, Number.EPSILON)
  const amount = (progress - previous.progress) / span
  return [
    previous.x + (next.x - previous.x) * amount - offsetX,
    previous.y + (next.y - previous.y) * amount - offsetY,
    progress,
  ]
}

/**
 * Resamples an over-detailed path down to the shader's vertex budget. The samples
 * span the contour: a closed path's last sample is the wrap-around point, an open
 * path ends one step short of it.
 */
function resampleGpuShapePathVertices(
  metricPoints: FlattenedPathPoint[],
  closed: boolean,
  transform: ItemTransform,
): GpuShapePathVertex[] {
  const sampleCount = MAX_GPU_SHAPE_PATH_VERTICES
  const divisor = closed ? sampleCount : sampleCount - 1
  return Array.from({ length: sampleCount }, (_, index) =>
    sampleGpuShapePathAtProgress(metricPoints, transform, index / divisor),
  )
}

/**
 * The shader vertices for a path shape, or `null` when the authored path cannot be
 * flattened into something drawable. The caller falls back to the canvas renderer
 * for those paths.
 */
export function resolveGpuShapePathVertices(
  shape: ShapeItem,
  transform: ItemTransform,
): GpuShapePathVertex[] | null {
  const vertices = shape.pathVertices
  const closed = shape.pathClosed ?? true
  // A closed contour needs a triangle's worth of vertices, an open one a segment's.
  const minVertexCount = closed ? 3 : 2
  if (!vertices || vertices.length < minVertexCount) return null
  const metricPoints = flattenBezierPath(vertices, transform.width, transform.height, closed).points
  const points = trimGpuShapePathClosure(metricPoints, closed)
  if (points.length < minVertexCount) return null
  if (points.length <= MAX_GPU_SHAPE_PATH_VERTICES) {
    const offsetX = transform.width / 2
    const offsetY = transform.height / 2
    return points.map(
      (point): GpuShapePathVertex => [point.x - offsetX, point.y - offsetY, point.progress],
    )
  }
  return resampleGpuShapePathVertices(metricPoints, closed, transform)
}

/** Why the GPU shape pipeline cannot draw a shape; the caller falls back to canvas. */
export type GpuShapeUnsupportedReason =
  | 'shape-pipeline-unavailable'
  | 'shape-mask'
  | 'unsupported-path-complexity'
  | 'unsupported-path-stroke-style'
  | 'canvas-trim-path-metrics-required'
  | 'unsupported-shape-fill'
  | 'unsupported-shape-stroke'
  | 'gpu-effects-pipeline-unavailable'

/** The capabilities the render context contributes to the decision. */
export interface GpuShapeSupportFlags {
  hasShapePipeline: boolean
  hasEffectsPipeline: boolean
  /** The item carries effects at all, enabled or not. */
  hasEffects: boolean
}

/** The authored stroke with the shader's defaults applied. */
interface GpuShapeStrokeParams {
  enabled: boolean
  width: number
  lineCap: string
  lineJoin: string
  color: string | undefined
}

function resolveGpuShapeStrokeParams(shape: ShapeItem): GpuShapeStrokeParams {
  return {
    enabled: shape.strokeEnabled !== false,
    width: shape.strokeWidth ?? 0,
    lineCap: shape.strokeLineCap ?? 'butt',
    lineJoin: shape.strokeLineJoin ?? 'miter',
    color: shape.strokeColor,
  }
}

/**
 * The fill the shader reads off the shape: a linear fill needs both of its
 * gradient colors parseable, a solid fill only its fill color.
 */
function hasParseableGpuShapeFill(shape: ShapeItem): boolean {
  const linearGradient = resolveShapeLinearGradient(shape)
  if (!linearGradient) return parseGpuColor(shape.fillColor) !== null
  return (
    parseGpuColor(linearGradient.startColor) !== null &&
    parseGpuColor(linearGradient.endColor) !== null
  )
}

/**
 * A stroked path only renders directly with rounded caps and joins; any other
 * cap or join needs the canvas renderer's stroke metrics.
 */
function resolveGpuShapePathStrokeGap(
  stroke: GpuShapeStrokeParams,
): GpuShapeUnsupportedReason | null {
  if (!stroke.enabled) return null
  // Only a positive width paints; a zero, negative or NaN width has no stroke to style.
  if (!(stroke.width > 0)) return null
  if (stroke.lineCap === 'round' && stroke.lineJoin === 'round') return null
  return 'unsupported-path-stroke-style'
}

/** A visible stroke color the shader cannot parse is a hard rejection. */
function resolveGpuShapeStrokePaintGap(
  stroke: GpuShapeStrokeParams,
): GpuShapeUnsupportedReason | null {
  if (!stroke.enabled) return null
  // Only a positive width paints; a zero, negative or NaN width has no stroke to check.
  if (!(stroke.width > 0)) return null
  if (!stroke.color) return null
  if (parseGpuColor(stroke.color) !== null) return null
  return 'unsupported-shape-stroke'
}

function resolveGpuShapePipelineGap(
  shape: ShapeItem,
  flags: GpuShapeSupportFlags,
): GpuShapeUnsupportedReason | null {
  if (!flags.hasShapePipeline) return 'shape-pipeline-unavailable'
  if (shape.isMask) return 'shape-mask'
  return null
}

/**
 * Path only: the authored contour has to flatten into shader vertices, and a
 * stroked path has to be round-capped, before the pipeline can draw it.
 */
function resolveGpuShapePathGap(
  shape: ShapeItem,
  transform: ItemTransform,
): GpuShapeUnsupportedReason | null {
  if (shape.shapeType !== 'path') return null
  if (!resolveGpuShapePathVertices(shape, transform)) return 'unsupported-path-complexity'
  return resolveGpuShapePathStrokeGap(resolveGpuShapeStrokeParams(shape))
}

/** Trim metrics are canvas-only: a trimmed non-path shape must not render directly. */
function resolveGpuShapeTrimGap(shape: ShapeItem): GpuShapeUnsupportedReason | null {
  if (shape.shapeType === 'path') return null
  if ((shape.trimPathStart ?? 0) === 0 && (shape.trimPathEnd ?? 100) === 100) return null
  return 'canvas-trim-path-metrics-required'
}

function resolveGpuShapePaintGap(shape: ShapeItem): GpuShapeUnsupportedReason | null {
  if (isGpuShapeFillEnabled(shape) && !hasParseableGpuShapeFill(shape)) {
    return 'unsupported-shape-fill'
  }
  return resolveGpuShapeStrokePaintGap(resolveGpuShapeStrokeParams(shape))
}

function resolveGpuShapeEffectsGap(
  flags: GpuShapeSupportFlags,
): GpuShapeUnsupportedReason | null {
  if (!flags.hasEffects) return null
  if (flags.hasEffectsPipeline) return null
  return 'gpu-effects-pipeline-unavailable'
}

/**
 * The first reason the GPU shape pipeline cannot draw this shape, in pipeline
 * order, or `null` when it can. The order is the diagnostic's contract: the
 * caller reports the returned reason next to the fallback it chose.
 */
export function resolveGpuShapeUnsupportedReason(
  shape: ShapeItem,
  transform: ItemTransform,
  flags: GpuShapeSupportFlags,
): GpuShapeUnsupportedReason | null {
  return (
    resolveGpuShapePipelineGap(shape, flags) ??
    resolveGpuShapePathGap(shape, transform) ??
    resolveGpuShapeTrimGap(shape) ??
    resolveGpuShapePaintGap(shape) ??
    resolveGpuShapeEffectsGap(flags)
  )
}
