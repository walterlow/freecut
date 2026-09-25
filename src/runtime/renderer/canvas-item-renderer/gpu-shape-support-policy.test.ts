// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import type { ShapeItem } from '@/types/timeline'
import type { ItemEffect } from '@/types/effects'
import { flattenBezierPath } from '@/shared/graphics/shapes/bezier-path'
import { resolveShapeLinearGradient } from '@/shared/graphics/shapes/linear-gradient'
import { MAX_GPU_SHAPE_PATH_VERTICES } from '@/infrastructure/gpu-shapes'
import { parseGpuColor } from './gpu-participant-policy'
import {
  resolveGpuShapePathVertices,
  resolveGpuShapeUnsupportedReason,
} from './gpu-shape-support-policy'
import type { GpuShapeUnsupportedReason } from './gpu-shape-support-policy'
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

type GpuShapeReasonMutation =
  | 'none'
  /** Checks only the path stroke's cap, so an unrounded join slips through. */
  | 'path-stroke-cap-only'
  /** Ignores the stroke width, so an invisible stroke is rejected as unparseable. */
  | 'stroke-width-ignored'
  /** Applies the trim-metric rule to path shapes too, pre-empting their reasons. */
  | 'trim-paths-too'
  /** Drops the effects-pipeline rule, so GPU effects are assumed renderable. */
  | 'effects-gap-ignored'

interface GpuShapeSupportFixture {
  hasShapePipeline: boolean
  hasEffectsPipeline: boolean
}

/**
 * Verbatim copy of the rejection ladder `getGpuShapeUnsupportedReason` ran inline in
 * `gpu.ts` before the move, narrowed to the two render-context capabilities it read
 * and parameterized by one deliberate defect at a time. The path resolver below is
 * the extracted one: the path tests in this file already pin it to the inline code,
 * so this oracle only has to prove the ladder itself.
 */
function gpuShapeUnsupportedReasonOracle(
  shape: ShapeItem,
  transform: ItemTransform,
  effects: readonly ItemEffect[],
  fixture: GpuShapeSupportFixture,
  mutation: GpuShapeReasonMutation,
): GpuShapeUnsupportedReason | null {
  if (!fixture.hasShapePipeline) return 'shape-pipeline-unavailable'
  if (shape.isMask) return 'shape-mask'
  if (shape.shapeType === 'path' && !resolveGpuShapePathVertices(shape, transform)) {
    return 'unsupported-path-complexity'
  }
  const strokeCap = shape.strokeLineCap ?? 'butt'
  const strokeJoin = shape.strokeLineJoin ?? 'miter'
  if (
    shape.shapeType === 'path' &&
    shape.strokeEnabled !== false &&
    (shape.strokeWidth ?? 0) > 0 &&
    (mutation === 'path-stroke-cap-only'
      ? strokeCap !== 'round'
      : strokeCap !== 'round' || strokeJoin !== 'round')
  ) {
    return 'unsupported-path-stroke-style'
  }
  if (
    (mutation === 'trim-paths-too' || shape.shapeType !== 'path') &&
    ((shape.trimPathStart ?? 0) !== 0 || (shape.trimPathEnd ?? 100) !== 100)
  ) {
    return 'canvas-trim-path-metrics-required'
  }
  const fillEnabled =
    shape.shapeType === 'path' && shape.pathClosed === false ? false : shape.fillEnabled !== false
  if (fillEnabled) {
    const linearGradient = resolveShapeLinearGradient(shape)
    if (
      !parseGpuColor(linearGradient?.startColor ?? shape.fillColor) ||
      (linearGradient && !parseGpuColor(linearGradient.endColor))
    ) {
      return 'unsupported-shape-fill'
    }
  }
  const strokeIsVisible =
    mutation === 'stroke-width-ignored'
      ? shape.strokeEnabled !== false
      : shape.strokeEnabled !== false && (shape.strokeWidth ?? 0) > 0
  if (strokeIsVisible && shape.strokeColor && !parseGpuColor(shape.strokeColor)) {
    return 'unsupported-shape-stroke'
  }
  if (mutation !== 'effects-gap-ignored' && effects.length > 0 && !fixture.hasEffectsPipeline) {
    return 'gpu-effects-pipeline-unavailable'
  }
  return null
}

const OPTIONAL_BOOLEANS = [undefined, true, false] as const
const SUPPORT_SHAPE_TYPES = ['rectangle', 'path', 'ellipse', 'polygon'] as const
const STROKE_WIDTHS = [undefined, 0, 1, 4, -4, Number.NaN] as const
const LINE_CAPS = [undefined, 'butt', 'round', 'square'] as const
const LINE_JOINS = [undefined, 'miter', 'round', 'bevel'] as const
const TRIM_STARTS = [undefined, 0, 25, -1] as const
const TRIM_ENDS = [undefined, 100, 50, 0] as const
const COLOR_STRINGS = ['#112233', '#abc', 'rgba(1,2,3,0.5)', 'bogus', ''] as const
const OPTIONAL_COLORS = [undefined, ...COLOR_STRINGS] as const
const FILL_TYPES = [undefined, 'solid', 'linear'] as const

const GPU_EFFECTS = [
  { id: 'effect-1', enabled: true, effect: { type: 'gpu-effect', params: {} } },
] as unknown as ItemEffect[]
const EFFECT_SETS: ReadonlyArray<ItemEffect[]> = [[], GPU_EFFECTS]

const SUPPORT_PATH_VERTEX_SETS: ReadonlyArray<MaskVertex[] | undefined> = [
  undefined,
  [],
  [straightVertex(0, 2), straightVertex(1, 2)],
  [straightVertex(0, 3), straightVertex(1, 3), straightVertex(2, 3)],
  Array.from({ length: MAX_GPU_SHAPE_PATH_VERTICES + 8 }, (_, index) =>
    zigzagVertex(index, MAX_GPU_SHAPE_PATH_VERTICES + 8),
  ),
]

interface GeneratedSupportCase {
  shape: ShapeItem
  transform: ItemTransform
  effects: ItemEffect[]
  fixture: GpuShapeSupportFixture
}

function makeGeneratedSupportShape(random: () => number): ShapeItem {
  return {
    ...BASE_SHAPE,
    shapeType: pick(random, SUPPORT_SHAPE_TYPES),
    isMask: pick(random, [undefined, true, false]),
    pathClosed: pick(random, [undefined, true, false]),
    pathVertices: pick(random, SUPPORT_PATH_VERTEX_SETS),
    fillType: pick(random, FILL_TYPES),
    fillEnabled: pick(random, OPTIONAL_BOOLEANS),
    fillColor: pick(random, COLOR_STRINGS),
    gradientStartColor: pick(random, OPTIONAL_COLORS),
    gradientEndColor: pick(random, OPTIONAL_COLORS),
    strokeEnabled: pick(random, OPTIONAL_BOOLEANS),
    strokeWidth: pick(random, STROKE_WIDTHS),
    strokeColor: pick(random, OPTIONAL_COLORS),
    strokeLineCap: pick(random, LINE_CAPS),
    strokeLineJoin: pick(random, LINE_JOINS),
    trimPathStart: pick(random, TRIM_STARTS),
    trimPathEnd: pick(random, TRIM_ENDS),
  }
}

const GENERATED_SUPPORT_CASES: GeneratedSupportCase[] = (() => {
  const random = createSeededRandom(0x5eed_2)
  const cases: GeneratedSupportCase[] = []
  for (let index = 0; index < 700; index++) {
    cases.push({
      shape: makeGeneratedSupportShape(random),
      transform: {
        ...BASE_TRANSFORM,
        width: pick(random, [1, 320, 200]),
        height: pick(random, [1, 180, 100]),
      },
      effects: pick(random, EFFECT_SETS),
      fixture: {
        hasShapePipeline: pick(random, [true, true, false]),
        hasEffectsPipeline: pick(random, [true, true, false]),
      },
    })
  }
  return cases
})()

interface ExplicitSupportCaseInput {
  shape: ShapeItem
  fixture: GpuShapeSupportFixture
  effects?: ItemEffect[]
}

/** Hand-picked shapes, one per rule of the ladder, in the order the ladder reads them. */
const explicitSupportInputs: ExplicitSupportCaseInput[] = [
  {
    // The pipeline gate outranks the mask rule.
    shape: { ...BASE_SHAPE, shapeType: 'rectangle', isMask: true },
    fixture: { hasShapePipeline: false, hasEffectsPipeline: true },
  },
  {
    shape: { ...BASE_SHAPE, shapeType: 'rectangle', isMask: true },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    shape: { ...BASE_SHAPE, shapeType: 'path', pathVertices: undefined },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    // A path whose stroke is not round-capped needs the canvas stroke metrics.
    shape: {
      ...BASE_SHAPE,
      shapeType: 'path',
      strokeEnabled: true,
      strokeWidth: 4,
      strokeLineCap: 'butt',
      strokeLineJoin: 'round',
      pathVertices: [straightVertex(0, 3), straightVertex(1, 3), straightVertex(2, 3)],
    },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    shape: {
      ...BASE_SHAPE,
      shapeType: 'path',
      strokeEnabled: true,
      strokeWidth: 4,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      pathVertices: [straightVertex(0, 3), straightVertex(1, 3), straightVertex(2, 3)],
    },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    shape: { ...BASE_SHAPE, shapeType: 'rectangle', trimPathStart: 10 },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    shape: { ...BASE_SHAPE, shapeType: 'rectangle', fillColor: 'bogus' },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    // The fill rule fires before the effects rule, even with both broken.
    shape: { ...BASE_SHAPE, shapeType: 'rectangle', fillColor: 'bogus' },
    effects: GPU_EFFECTS,
    fixture: { hasShapePipeline: true, hasEffectsPipeline: false },
  },
  {
    // An open path cannot be filled, so its unparseable fill is never reached.
    shape: {
      ...BASE_SHAPE,
      shapeType: 'path',
      pathClosed: false,
      fillColor: 'bogus',
      pathVertices: [straightVertex(0, 3), straightVertex(1, 3), straightVertex(2, 3)],
    },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    shape: {
      ...BASE_SHAPE,
      shapeType: 'rectangle',
      strokeEnabled: true,
      strokeWidth: 2,
      strokeColor: 'bogus',
    },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    // A zero-width stroke paints nothing, so its color is never parsed.
    shape: {
      ...BASE_SHAPE,
      shapeType: 'rectangle',
      strokeEnabled: true,
      strokeWidth: 0,
      strokeColor: 'bogus',
    },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
  {
    shape: { ...BASE_SHAPE, shapeType: 'rectangle' },
    effects: GPU_EFFECTS,
    fixture: { hasShapePipeline: true, hasEffectsPipeline: false },
  },
  {
    // A NaN width is not a painted stroke either; `!== 0` guards would regress here.
    shape: {
      ...BASE_SHAPE,
      shapeType: 'rectangle',
      strokeEnabled: true,
      strokeWidth: Number.NaN,
      strokeColor: 'bogus',
    },
    fixture: { hasShapePipeline: true, hasEffectsPipeline: true },
  },
]

const EXPLICIT_SUPPORT_CASES: GeneratedSupportCase[] = explicitSupportInputs.map((input) => ({
  shape: input.shape,
  transform: BASE_TRANSFORM,
  effects: input.effects ?? [],
  fixture: input.fixture,
}))

const ALL_SUPPORT_CASES = [...EXPLICIT_SUPPORT_CASES, ...GENERATED_SUPPORT_CASES]
const REASON_MUTATIONS = [
  'path-stroke-cap-only',
  'stroke-width-ignored',
  'trim-paths-too',
  'effects-gap-ignored',
] as const

function resolveSupportedReason(entry: GeneratedSupportCase): GpuShapeUnsupportedReason | null {
  return resolveGpuShapeUnsupportedReason(entry.shape, entry.transform, {
    hasShapePipeline: entry.fixture.hasShapePipeline,
    hasEffectsPipeline: entry.fixture.hasEffectsPipeline,
    hasEffects: entry.effects.length > 0,
  })
}

describe('resolveGpuShapeUnsupportedReason', () => {
  it('matches the inline rejection ladder it replaced across generated shapes', () => {
    for (const entry of ALL_SUPPORT_CASES) {
      expect(resolveSupportedReason(entry)).toEqual(
        gpuShapeUnsupportedReasonOracle(
          entry.shape,
          entry.transform,
          entry.effects,
          entry.fixture,
          'none',
        ),
      )
    }
  })

  it('exercises every rejection reason and the renderable shape', () => {
    const counts: Record<string, number> = {}
    for (const entry of ALL_SUPPORT_CASES) {
      const reason = String(resolveSupportedReason(entry))
      counts[reason] = (counts[reason] ?? 0) + 1
    }
    // toEqual fixes the key set, so a corpus that stopped reaching one of the
    // ladder's rules would drop its reason here.
    expect(counts).toEqual({
      null: expect.any(Number),
      'canvas-trim-path-metrics-required': expect.any(Number),
      'gpu-effects-pipeline-unavailable': expect.any(Number),
      'shape-mask': expect.any(Number),
      'shape-pipeline-unavailable': expect.any(Number),
      'unsupported-path-complexity': expect.any(Number),
      'unsupported-path-stroke-style': expect.any(Number),
      'unsupported-shape-fill': expect.any(Number),
      'unsupported-shape-stroke': expect.any(Number),
    })
  })

  it('reports the first reason in pipeline order', () => {
    const expectations: Array<[number, GpuShapeUnsupportedReason | null]> = [
      [0, 'shape-pipeline-unavailable'],
      [1, 'shape-mask'],
      [2, 'unsupported-path-complexity'],
      [3, 'unsupported-path-stroke-style'],
      [4, null],
      [5, 'canvas-trim-path-metrics-required'],
      [6, 'unsupported-shape-fill'],
      [7, 'unsupported-shape-fill'],
      [8, null],
      [9, 'unsupported-shape-stroke'],
      [10, null],
      [11, 'gpu-effects-pipeline-unavailable'],
      [12, null],
    ]
    for (const [index, expected] of expectations) {
      expect(resolveSupportedReason(EXPLICIT_SUPPORT_CASES[index]!)).toBe(expected)
    }
  })

  it('keeps an open path fillable-only-when-closed rule out of the rejection', () => {
    const openPath: ShapeItem = {
      ...BASE_SHAPE,
      shapeType: 'path',
      pathClosed: false,
      fillEnabled: true,
      fillColor: 'bogus',
      pathVertices: [straightVertex(0, 3), straightVertex(1, 3), straightVertex(2, 3)],
    }
    expect(resolveGpuShapeUnsupportedReason(openPath, BASE_TRANSFORM, {
      hasShapePipeline: true,
      hasEffectsPipeline: true,
      hasEffects: false,
    })).toBeNull()
    expect(resolveGpuShapeUnsupportedReason({ ...openPath, pathClosed: true }, BASE_TRANSFORM, {
      hasShapePipeline: true,
      hasEffectsPipeline: true,
      hasEffects: false,
    })).toBe('unsupported-shape-fill')
  })

  it('detects a drifted ladder, so the oracle comparison can fail', () => {
    for (const mutation of REASON_MUTATIONS) {
      const drifted = ALL_SUPPORT_CASES.some(
        (entry) =>
          resolveSupportedReason(entry) !==
          gpuShapeUnsupportedReasonOracle(
            entry.shape,
            entry.transform,
            entry.effects,
            entry.fixture,
            mutation,
          ),
      )
      expect({ mutation, drifted }).toEqual({ mutation, drifted: true })
    }
  })
})
