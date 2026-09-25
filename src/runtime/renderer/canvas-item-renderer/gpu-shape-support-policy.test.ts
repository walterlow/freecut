// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import type { ShapeItem } from '@/types/timeline'
import { flattenBezierPath } from '@/shared/graphics/shapes/bezier-path'
import { MAX_GPU_SHAPE_PATH_VERTICES } from '@/infrastructure/gpu-shapes'
import { resolveGpuShapePathVertices } from './gpu-shape-support-policy'
import type { ItemTransform } from './types'

type GpuShapePathMutation =
  | 'none'
  /** Leaves the vertices in path space instead of centring them on the transform. */
  | 'path-space-vertices'
  /** Trims the contour-closing point of open paths too, dropping their last vertex. */
  | 'trim-open-contours'
  /** Resamples an open path with the closed divisor, missing its end point. */
  | 'closed-divisor'

/**
 * Verbatim copy of the resolver as it stood inline in `gpu.ts` before the move,
 * including the sampler it closed over. It stays here as the equivalence oracle —
 * and, mutated one defect at a time, as the proof that the generated corpus can
 * tell a drifted resolver apart from the inline one.
 */
function resolveGpuShapePathVerticesOracle(
  shape: ShapeItem,
  transform: ItemTransform,
  mutation: GpuShapePathMutation,
): Array<[number, number, number?]> | null {
  const vertices = shape.pathVertices
  const closed = shape.pathClosed ?? true
  if (!vertices || vertices.length < (closed ? 3 : 2)) return null
  const flattened = flattenBezierPath(vertices, transform.width, transform.height, closed)
  const metricPoints = flattened.points
  let points = metricPoints
  const repeatsStart = points.length > 1 && points.at(-1)?.progress === 1
  if (mutation === 'trim-open-contours' ? repeatsStart : closed && repeatsStart) {
    points = points.slice(0, -1)
  }
  if (points.length < (closed ? 3 : 2)) return null

  const offsetX = mutation === 'path-space-vertices' ? 0 : transform.width / 2
  const offsetY = mutation === 'path-space-vertices' ? 0 : transform.height / 2

  const sampleAtProgress = (progress: number): [number, number, number] => {
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

  if (points.length <= MAX_GPU_SHAPE_PATH_VERTICES) {
    return points.map((point) => [point.x - offsetX, point.y - offsetY, point.progress])
  }
  const sampleCount = MAX_GPU_SHAPE_PATH_VERTICES
  const divisor =
    mutation === 'closed-divisor' ? sampleCount : closed ? sampleCount : sampleCount - 1
  return Array.from({ length: sampleCount }, (_, index) => sampleAtProgress(index / divisor))
}

const BASE_SHAPE: ShapeItem = {
  id: 'base-shape',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Shape',
  shapeType: 'path',
  fillColor: '#112233',
  fillType: 'solid',
  transform: { x: 0, y: 0, width: 200, height: 100 },
}

const BASE_TRANSFORM: ItemTransform = {
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!
}

function makeVertex(random: () => number): MaskVertex {
  const position: [number, number] = [
    Number((random() * 2 - 1).toFixed(3)),
    Number((random() * 2 - 1).toFixed(3)),
  ]
  const handle = (): [number, number] => [
    Number((random() * 0.8 - 0.4).toFixed(3)),
    Number((random() * 0.8 - 0.4).toFixed(3)),
  ]
  return { position, inHandle: handle(), outHandle: handle() }
}

function straightVertex(index: number, count: number): MaskVertex {
  return { position: [index / count, 0.5], inHandle: [0, 0], outHandle: [0, 0] }
}

function zigzagVertex(index: number, count: number): MaskVertex {
  return { position: [index / count, index % 2], inHandle: [0, 0], outHandle: [0, 0] }
}

/** A curve-heavy contour whose flattening overruns the shader's vertex budget. */
function makeOverDetailedPath(random: () => number, vertexCount: number): MaskVertex[] {
  return Array.from({ length: vertexCount }, (_, index): MaskVertex => {
    const angle = (index / vertexCount) * Math.PI * 4
    const position: [number, number] = [
      Number((Math.cos(angle) * 0.9).toFixed(3)),
      Number((Math.sin(angle) * 0.9).toFixed(3)),
    ]
    const tangent: [number, number] = [
      Number((random() * 0.9 - 0.45).toFixed(3)),
      Number((random() * 0.9 - 0.45).toFixed(3)),
    ]
    return { position, inHandle: [-tangent[0], -tangent[1]], outHandle: tangent }
  })
}

interface GeneratedPathCase {
  shape: ShapeItem
  transform: ItemTransform
}

function straightContourCase(vertexCount: number, pathClosed: boolean): GeneratedPathCase {
  return {
    shape: {
      ...BASE_SHAPE,
      pathClosed,
      pathVertices: Array.from({ length: vertexCount }, (_, index) =>
        straightVertex(index, vertexCount),
      ),
    },
    transform: BASE_TRANSFORM,
  }
}

function zigzagContourCase(vertexCount: number, pathClosed: boolean): GeneratedPathCase {
  return {
    shape: {
      ...BASE_SHAPE,
      pathClosed,
      pathVertices: Array.from({ length: vertexCount }, (_, index) =>
        zigzagVertex(index, vertexCount),
      ),
    },
    transform: BASE_TRANSFORM,
  }
}

const PATH_LENGTHS = [0, 1, 2, 3, 4, 5, 8, 16, 33, 60] as const
const PATH_CLOSURES = [undefined, true, false] as const

const GENERATED_PATH_CASES: GeneratedPathCase[] = (() => {
  const random = createSeededRandom(0x5eed_1)
  const cases: GeneratedPathCase[] = []
  for (const vertexCount of PATH_LENGTHS) {
    for (const pathClosed of PATH_CLOSURES) {
      for (let sample = 0; sample < 40; sample++) {
        cases.push({
          shape: {
            ...BASE_SHAPE,
            pathClosed,
            pathVertices: Array.from({ length: vertexCount }, () => makeVertex(random)),
          },
          transform: {
            ...BASE_TRANSFORM,
            width: pick(random, [1, 320, 200, 1024]),
            height: pick(random, [1, 180, 100, 768]),
          },
        })
      }
    }
  }
  // Straight contours flattens to one point per vertex, so these pin the exact
  // budget boundary; the curvy ones overrun it and force the resampler.
  for (const pathClosed of PATH_CLOSURES) {
    cases.push(straightContourCase(MAX_GPU_SHAPE_PATH_VERTICES, pathClosed === true))
    cases.push(zigzagContourCase(MAX_GPU_SHAPE_PATH_VERTICES + 8, pathClosed === true))
    cases.push(straightContourCase(MAX_GPU_SHAPE_PATH_VERTICES + 1, pathClosed === true))
    for (const vertexCount of [16, 40, 80]) {
      cases.push({
        shape: {
          ...BASE_SHAPE,
          pathClosed,
          pathVertices: makeOverDetailedPath(random, vertexCount),
        },
        transform: BASE_TRANSFORM,
      })
    }
  }
  return cases
})()

/** Hand-picked contours: missing / degenerate vertex counts and coincident points. */
const EDGE_PATH_CASES: GeneratedPathCase[] = [
  { shape: { ...BASE_SHAPE, pathVertices: undefined }, transform: BASE_TRANSFORM },
  { shape: { ...BASE_SHAPE, pathVertices: [] }, transform: BASE_TRANSFORM },
  {
    shape: { ...BASE_SHAPE, pathVertices: [straightVertex(0, 1)] },
    transform: BASE_TRANSFORM,
  },
  {
    // Two vertices are one short of a closed contour and exactly an open one.
    shape: {
      ...BASE_SHAPE,
      pathVertices: [straightVertex(0, 2), straightVertex(1, 2)],
    },
    transform: BASE_TRANSFORM,
  },
  {
    // Three coincident points: zero total length, so every progress collapses to 0.
    shape: {
      ...BASE_SHAPE,
      pathVertices: Array.from(
        { length: 3 },
        (): MaskVertex => ({ position: [0.5, 0.5], inHandle: [0, 0], outHandle: [0, 0] }),
      ),
    },
    transform: BASE_TRANSFORM,
  },
]

const ALL_PATH_CASES = [...EDGE_PATH_CASES, ...GENERATED_PATH_CASES]
const MUTATIONS = ['path-space-vertices', 'trim-open-contours', 'closed-divisor'] as const

function sameVertices(
  left: Array<[number, number, number?]> | null,
  right: Array<[number, number, number?]> | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

describe('resolveGpuShapePathVertices', () => {
  it('matches the inline resolver it replaced across generated paths', () => {
    for (const { shape, transform } of ALL_PATH_CASES) {
      expect(resolveGpuShapePathVertices(shape, transform)).toEqual(
        resolveGpuShapePathVerticesOracle(shape, transform, 'none'),
      )
    }
  })

  it('emits the flattened vertices directly while the path fits the budget', () => {
    const { shape } = straightContourCase(MAX_GPU_SHAPE_PATH_VERTICES, false)
    const direct = resolveGpuShapePathVertices(shape, BASE_TRANSFORM)
    expect(direct).toHaveLength(MAX_GPU_SHAPE_PATH_VERTICES)
    // Straight contour: uniform arc length, so the progress tags are the flattened ones.
    expect(direct!.map((vertex) => vertex[2])).toEqual(
      Array.from({ length: MAX_GPU_SHAPE_PATH_VERTICES }, (_, index) =>
        index / (MAX_GPU_SHAPE_PATH_VERTICES - 1),
      ),
    )
  })

  it('resamples an over-detailed path onto the uniform progress grid', () => {
    const { shape } = zigzagContourCase(MAX_GPU_SHAPE_PATH_VERTICES + 8, true)
    const resampled = resolveGpuShapePathVertices(shape, BASE_TRANSFORM)
    expect(resampled).toHaveLength(MAX_GPU_SHAPE_PATH_VERTICES)
    expect(resampled!.map((vertex) => vertex[2])).toEqual(
      Array.from({ length: MAX_GPU_SHAPE_PATH_VERTICES }, (_, index) =>
        index / MAX_GPU_SHAPE_PATH_VERTICES,
      ),
    )
  })

  it('rejects the paths the shader cannot draw', () => {
    expect(
      resolveGpuShapePathVertices({ ...BASE_SHAPE, pathVertices: undefined }, BASE_TRANSFORM),
    ).toBeNull()
    expect(
      resolveGpuShapePathVertices({ ...BASE_SHAPE, pathVertices: [] }, BASE_TRANSFORM),
    ).toBeNull()
    expect(
      resolveGpuShapePathVertices(
        { ...BASE_SHAPE, pathVertices: [straightVertex(0, 1)] },
        BASE_TRANSFORM,
      ),
    ).toBeNull()
    expect(
      resolveGpuShapePathVertices(
        { ...BASE_SHAPE, pathVertices: [straightVertex(0, 2), straightVertex(1, 2)] },
        BASE_TRANSFORM,
      ),
    ).toBeNull()
    expect(
      resolveGpuShapePathVertices(
        { ...BASE_SHAPE, pathClosed: false, pathVertices: [straightVertex(0, 2), straightVertex(1, 2)] },
        BASE_TRANSFORM,
      ),
    ).toHaveLength(2)
  })

  it('centres the vertices on the transform and keeps their progress', () => {
    const flat: ShapeItem = {
      ...BASE_SHAPE,
      pathClosed: false,
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
      ],
    }
    expect(resolveGpuShapePathVertices(flat, BASE_TRANSFORM)).toEqual([
      [-160, -90, 0],
      [160, 90, 1],
    ])
  })

  it('trims the closing point of a closed contour', () => {
    const square: ShapeItem = {
      ...BASE_SHAPE,
      pathClosed: true,
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [0, 1], inHandle: [0, 0], outHandle: [0, 0] },
      ],
    }
    // A square contour in a square transform, so every side carries equal length.
    const squareTransform: ItemTransform = { ...BASE_TRANSFORM, width: 200, height: 200 }
    const closed = resolveGpuShapePathVertices(square, squareTransform)
    const open = resolveGpuShapePathVertices({ ...square, pathClosed: false }, squareTransform)
    // The closed contour's fifth flattened point repeats its first, so the trim
    // leaves the four distinct vertices behind with the wrap left unlabelled.
    expect(closed).toHaveLength(4)
    expect(closed!.map((vertex) => vertex[2])).toEqual([0, 0.25, 0.5, 0.75])
    expect(open).toHaveLength(4)
    expect(open!.at(-1)![2]).toBe(1)
  })

  it('detects a drifted resolver, so the oracle comparison can fail', () => {
    for (const mutation of MUTATIONS) {
      const drifted = ALL_PATH_CASES.some(
        ({ shape, transform }) =>
          !sameVertices(
            resolveGpuShapePathVertices(shape, transform),
            resolveGpuShapePathVerticesOracle(shape, transform, mutation),
          ),
      )
      expect({ mutation, drifted }).toEqual({ mutation, drifted: true })
    }
  })
})
