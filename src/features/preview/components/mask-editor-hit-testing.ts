import type { MaskVertex } from '@/types/masks'
import { cubicPointAt, distanceToLineSegment, isPointInPolygon } from './mask-editor-overlay-utils'

export type MaskHit =
  | { type: 'vertex' | 'inHandle' | 'outHandle' | 'segment'; index: number }
  | { type: 'shape' }

export type PenHit = {
  type: 'vertex' | 'inHandle' | 'outHandle'
  index: number
}

type VertexToScreen = (vertex: MaskVertex) => [number, number]
type HandleToScreen = (vertex: MaskVertex, handleType: 'in' | 'out') => [number, number]

interface HitTestMaskVerticesOptions {
  vertices: MaskVertex[]
  screenX: number
  screenY: number
  hitRadius: number
  curveHitTestSteps: number
  vertexToScreen: VertexToScreen
  handleToScreen: HandleToScreen
}

export function hitTestMaskVertices({
  vertices,
  screenX,
  screenY,
  hitRadius,
  curveHitTestSteps,
  vertexToScreen,
  handleToScreen,
}: HitTestMaskVerticesOptions): MaskHit | null {
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i]!
    if (vertex.inHandle[0] !== 0 || vertex.inHandle[1] !== 0) {
      const [hx, hy] = handleToScreen(vertex, 'in')
      if (Math.hypot(screenX - hx, screenY - hy) < hitRadius) {
        return { type: 'inHandle', index: i }
      }
    }
    if (vertex.outHandle[0] !== 0 || vertex.outHandle[1] !== 0) {
      const [hx, hy] = handleToScreen(vertex, 'out')
      if (Math.hypot(screenX - hx, screenY - hy) < hitRadius) {
        return { type: 'outHandle', index: i }
      }
    }
  }

  for (let i = 0; i < vertices.length; i++) {
    const [vx, vy] = vertexToScreen(vertices[i]!)
    if (Math.hypot(screenX - vx, screenY - vy) < hitRadius) {
      return { type: 'vertex', index: i }
    }
  }

  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]!
    const next = vertices[(i + 1) % vertices.length]!
    const [x1, y1] = vertexToScreen(curr)
    const [x2, y2] = vertexToScreen(next)
    const isStraight =
      curr.outHandle[0] === 0 &&
      curr.outHandle[1] === 0 &&
      next.inHandle[0] === 0 &&
      next.inHandle[1] === 0

    if (isStraight) {
      if (distanceToLineSegment(screenX, screenY, x1, y1, x2, y2) < hitRadius) {
        return { type: 'segment', index: i }
      }
      continue
    }

    const [cp1x, cp1y] = handleToScreen(curr, 'out')
    const [cp2x, cp2y] = handleToScreen(next, 'in')
    let prevX = x1
    let prevY = y1

    for (let step = 1; step <= curveHitTestSteps; step++) {
      const t = step / curveHitTestSteps
      const curveX = cubicPointAt(x1, cp1x, cp2x, x2, t)
      const curveY = cubicPointAt(y1, cp1y, cp2y, y2, t)

      if (distanceToLineSegment(screenX, screenY, prevX, prevY, curveX, curveY) < hitRadius) {
        return { type: 'segment', index: i }
      }

      prevX = curveX
      prevY = curveY
    }
  }

  if (vertices.length >= 3) {
    const polygon: [number, number][] = [vertexToScreen(vertices[0]!)]

    for (let i = 0; i < vertices.length; i++) {
      const curr = vertices[i]!
      const next = vertices[(i + 1) % vertices.length]!
      const [startX, startY] = vertexToScreen(curr)
      const [endX, endY] = vertexToScreen(next)
      const isStraight =
        curr.outHandle[0] === 0 &&
        curr.outHandle[1] === 0 &&
        next.inHandle[0] === 0 &&
        next.inHandle[1] === 0

      if (isStraight) {
        polygon.push([endX, endY])
        continue
      }

      const [cp1x, cp1y] = handleToScreen(curr, 'out')
      const [cp2x, cp2y] = handleToScreen(next, 'in')

      for (let step = 1; step <= curveHitTestSteps; step++) {
        const t = step / curveHitTestSteps
        polygon.push([
          cubicPointAt(startX, cp1x, cp2x, endX, t),
          cubicPointAt(startY, cp1y, cp2y, endY, t),
        ])
      }
    }

    if (isPointInPolygon(screenX, screenY, polygon)) {
      return { type: 'shape' }
    }
  }

  return null
}

interface HitTestPenVerticesOptions {
  vertices: MaskVertex[]
  screenX: number
  screenY: number
  hitRadius: number
  vertexToScreen: VertexToScreen
  handleToScreen: HandleToScreen
}

export function hitTestPenVertices({
  vertices,
  screenX,
  screenY,
  hitRadius,
  vertexToScreen,
  handleToScreen,
}: HitTestPenVerticesOptions): PenHit | null {
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i]!
    if (vertex.inHandle[0] !== 0 || vertex.inHandle[1] !== 0) {
      const [hx, hy] = handleToScreen(vertex, 'in')
      if (Math.hypot(screenX - hx, screenY - hy) < hitRadius) {
        return { type: 'inHandle', index: i }
      }
    }
    if (vertex.outHandle[0] !== 0 || vertex.outHandle[1] !== 0) {
      const [hx, hy] = handleToScreen(vertex, 'out')
      if (Math.hypot(screenX - hx, screenY - hy) < hitRadius) {
        return { type: 'outHandle', index: i }
      }
    }
  }

  for (let i = 0; i < vertices.length; i++) {
    const [vx, vy] = vertexToScreen(vertices[i]!)
    if (Math.hypot(screenX - vx, screenY - vy) < hitRadius) {
      return { type: 'vertex', index: i }
    }
  }

  return null
}
