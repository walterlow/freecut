/**
 * Pure path policy for the GPU shape pipeline (`gpu.ts`): the canvas-space
 * vertices the shape shader consumes for an authored bezier path. Nothing here
 * touches a `GPUTexture`, a pipeline or a render context, so the flatten /
 * closure-trim / resample ladder can be unit tested without a device; texture
 * uploads and the pipeline calls stay in `gpu.ts`.
 */

import type { ShapeItem } from '@/types/timeline'
import type { FlattenedPathPoint } from '@/shared/graphics/shapes/bezier-path'
import { flattenBezierPath } from '@/shared/graphics/shapes/bezier-path'
import { MAX_GPU_SHAPE_PATH_VERTICES } from '@/infrastructure/gpu-shapes'
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
