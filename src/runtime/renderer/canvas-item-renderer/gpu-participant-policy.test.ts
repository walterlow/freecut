// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { resolveShapeLinearGradient } from '@/shared/graphics/shapes/linear-gradient'
import { resolveAnimatedShapeItem } from '@/runtime/renderer/deps/keyframes-contract'
import { getLogicalCanvasSize, scaleShapeItemForCanvas } from '../canvas-render-scale'
import { resolvePreviewDomVideoDrawDecision } from '../frame-source-policy'
import {
  canUseGpuVideoExtractorSource,
  parseGpuColor,
  resolveGpuDomVideoDrawDecision,
  resolveGpuShapeSourceItem,
  resolveGpuShapeStyle,
  type GpuShapeColor,
  type GpuShapeStyle,
  type GpuSourceTimeRamp,
} from './gpu-participant-policy'
import type { CanvasSettings } from './types'

/**
 * Verbatim copy of the parser as it stood inline in `gpu.ts` before the move.
 * It stays here as the equivalence oracle: the extracted policy must agree with
 * it on every generated input, so a silent format regression cannot slip in.
 */
function parseGpuColorVerbatim(color: string): GpuShapeColor | null {
  const trimmed = color.trim()
  const hex = trimmed.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)
  if (hex) {
    let value = hex[1]!
    if (value.length === 3) {
      value = value
        .split('')
        .map((ch) => ch + ch)
        .join('')
    }
    const r = Number.parseInt(value.slice(0, 2), 16) / 255
    const g = Number.parseInt(value.slice(2, 4), 16) / 255
    const b = Number.parseInt(value.slice(4, 6), 16) / 255
    const a = value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1
    return [r, g, b, a]
  }
  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i)
  if (!rgb) return null
  const parts = rgb[1]!.split(',').map((part) => part.trim())
  if (parts.length < 3) return null
  const parseChannel = (part: string) =>
    part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part) / 255
  const r = parseChannel(parts[0]!)
  const g = parseChannel(parts[1]!)
  const b = parseChannel(parts[2]!)
  const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) return null
  return [r, g, b, a]
}

/**
 * Verbatim copy of the inline fill / gradient / stroke block that
 * `resolveGpuMediaParticipantSource` used to run for shape participants.
 * `null` mirrors the `return null` the inline block did on an unparseable fill.
 */
function referenceGpuShapeStyle(shape: ShapeItem): GpuShapeStyle | null {
  const linearGradient = resolveShapeLinearGradient(shape)
  const parsedFillColor = parseGpuColorVerbatim(linearGradient?.startColor ?? shape.fillColor)
  const parsedGradientEndColor = linearGradient
    ? parseGpuColorVerbatim(linearGradient.endColor)
    : undefined
  const parsedStrokeColor =
    (shape.strokeEnabled ?? true) && shape.strokeWidth && shape.strokeWidth > 0 && shape.strokeColor
      ? parseGpuColorVerbatim(shape.strokeColor)
      : undefined
  if (!parsedFillColor || (linearGradient && !parsedGradientEndColor)) return null
  const fillEnabled =
    shape.shapeType === 'path' && shape.pathClosed === false ? false : (shape.fillEnabled ?? true)
  const fillColor: GpuShapeColor = fillEnabled
    ? parsedFillColor
    : [parsedFillColor[0], parsedFillColor[1], parsedFillColor[2], 0]
  const strokeColor = parsedStrokeColor ?? undefined
  const gradientEndColor: GpuShapeColor | undefined =
    parsedGradientEndColor && linearGradient
      ? fillEnabled
        ? parsedGradientEndColor
        : [parsedGradientEndColor[0], parsedGradientEndColor[1], parsedGradientEndColor[2], 0]
      : undefined
  return {
    fillColor,
    gradientEndColor,
    gradientAngleRad: linearGradient ? (linearGradient.angle * Math.PI) / 180 : undefined,
    strokeColor,
  }
}

/** Same policy with one deliberate mutation: a disabled fill keeps its alpha. */
function brokenGpuShapeStyle(shape: ShapeItem): GpuShapeStyle | null {
  const style = resolveGpuShapeStyle(shape)
  if (!style) return null
  return { ...style, fillColor: [style.fillColor[0], style.fillColor[1], style.fillColor[2], 1] }
}

/** Verbatim copy of the inline animated/scaled shape derivation. */
function referenceGpuShapeSourceItem(
  item: ShapeItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  canvasSettings: CanvasSettings,
): ShapeItem {
  const logicalCanvasSettings = getLogicalCanvasSize(canvasSettings)
  return scaleShapeItemForCanvas(
    resolveAnimatedShapeItem(
      item,
      itemKeyframes,
      frame - item.from,
      canvasSettings.getExpressionItem && canvasSettings.getExpressionKeyframes
        ? {
            globalFrame: frame,
            canvas: logicalCanvasSettings,
            getItem: canvasSettings.getExpressionItem,
            getKeyframes: canvasSettings.getExpressionKeyframes,
          }
        : undefined,
    ),
    canvasSettings,
  )
}

/**
 * Verbatim copy of the inline transition DOM-video decision, including the
 * source-time ramp ladder that decided whether that video's clock is
 * trustworthy.
 */
function referenceGpuDomVideoDrawDecision(input: DomVideoDecisionInput) {
  const ramp = input.sourceTimeRamp
  const hasActiveRamp =
    ramp !== undefined && input.frame >= ramp.rampStart && input.frame <= ramp.rampEnd
  const canUseSynchronizedDomVideo =
    !hasActiveRamp || input.domVideo?.dataset.transitionSourceRamp === '1'
  return resolvePreviewDomVideoDrawDecision({
    domVideo: canUseSynchronizedDomVideo ? input.domVideo : null,
    sourceTime: input.sourceTime,
    speed: input.domVideo?.playbackRate ?? input.itemSpeed ?? 1,
    isRenderingTransition: true,
  })
}

/** Same decision with one deliberate mutation: a ramped span is always trusted. */
function brokenGpuDomVideoDrawDecision(input: DomVideoDecisionInput) {
  return resolvePreviewDomVideoDrawDecision({
    domVideo: input.domVideo,
    sourceTime: input.sourceTime,
    speed: input.domVideo?.playbackRate ?? input.itemSpeed ?? 1,
    isRenderingTransition: true,
  })
}

interface DomVideoDecisionInput {
  domVideo: HTMLVideoElement | null
  sourceTimeRamp: GpuSourceTimeRamp | undefined
  frame: number
  sourceTime: number
  itemSpeed: number | undefined
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

const COLOR_STRINGS = [
  '#112233',
  '#ABC',
  '#11223344',
  '  #445566  ',
  'rgb(10, 20, 30)',
  'rgba(10, 20, 30, 0.25)',
  'rgb(10%, 20%, 30%)',
  'rgb(10, 20)',
  'rgb(a, b, c)',
  'not-a-color',
  '',
] as const

const OPTIONAL_COLORS = [undefined, '#ff0000', '#00ff0080', 'rgba(1,2,3,0.5)', 'bogus'] as const
const OPTIONAL_BOOLEANS = [undefined, true, false] as const
const FILL_TYPES = [undefined, 'solid', 'linear'] as const
const SHAPE_TYPES = ['rectangle', 'path', 'ellipse'] as const
const GRADIENT_ANGLES = [undefined, 0, 45, -90, Number.NaN] as const
const STROKE_WIDTHS = [undefined, 0, 1, 4, -4, Number.NaN] as const

const BASE_SHAPE: ShapeItem = {
  id: 'base-shape',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Shape',
  shapeType: 'rectangle',
  fillColor: '#112233',
  fillType: 'solid',
  transform: { x: 0, y: 0, width: 200, height: 100 },
}

function makeGeneratedShape(random: () => number): ShapeItem {
  return {
    ...BASE_SHAPE,
    shapeType: pick(random, SHAPE_TYPES),
    fillColor: pick(random, COLOR_STRINGS),
    fillEnabled: pick(random, OPTIONAL_BOOLEANS),
    fillType: pick(random, FILL_TYPES),
    gradientStartColor: pick(random, OPTIONAL_COLORS),
    gradientEndColor: pick(random, OPTIONAL_COLORS),
    gradientAngle: pick(random, GRADIENT_ANGLES),
    strokeEnabled: pick(random, OPTIONAL_BOOLEANS),
    strokeWidth: pick(random, STROKE_WIDTHS),
    strokeColor: pick(random, OPTIONAL_COLORS),
    pathClosed: pick(random, OPTIONAL_BOOLEANS),
  }
}

const GENERATED_SHAPES: ShapeItem[] = (() => {
  const random = createSeededRandom(0x5eed)
  return Array.from({ length: 600 }, () => makeGeneratedShape(random))
})()

function sameStyle(left: GpuShapeStyle | null, right: GpuShapeStyle | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const TAPER_KEYFRAMES: ItemKeyframes = {
  itemId: BASE_SHAPE.id,
  properties: [
    {
      // taperStartWidth is a shape-animatable property; strokeWidth is not.
      property: 'taperStartWidth',
      keyframes: [
        { id: 'k1', frame: 0, value: 100, easing: 'linear' },
        { id: 'k2', frame: 60, value: 160, easing: 'linear' },
      ],
    },
  ],
}

const FULL_CANVAS: CanvasSettings = { width: 1920, height: 1080, fps: 30 }
const PREVIEW_CANVAS: CanvasSettings = {
  width: 960,
  height: 540,
  logicalWidth: 1920,
  logicalHeight: 1080,
  fps: 30,
}
const EXPRESSION_CANVAS: CanvasSettings = {
  ...FULL_CANVAS,
  getExpressionItem: () => BASE_SHAPE,
  getExpressionKeyframes: () => undefined,
}

function makeDomVideo(overrides: {
  readyState?: number
  videoWidth?: number
  currentTime?: number
  playbackRate?: number
  transitionSourceRamp?: string
  transitionHold?: string
}): HTMLVideoElement {
  return {
    readyState: overrides.readyState ?? 4,
    videoWidth: overrides.videoWidth ?? 1920,
    currentTime: overrides.currentTime ?? 0,
    playbackRate: overrides.playbackRate ?? 1,
    dataset: {
      ...(overrides.transitionSourceRamp === undefined
        ? {}
        : { transitionSourceRamp: overrides.transitionSourceRamp }),
      ...(overrides.transitionHold === undefined
        ? {}
        : { transitionHold: overrides.transitionHold }),
    },
  } as unknown as HTMLVideoElement
}

const RAMPS: Array<GpuSourceTimeRamp | undefined> = [
  undefined,
  { rampStart: 0, rampEnd: 0 },
  { rampStart: 10, rampEnd: 40 },
  { rampStart: 12.5, rampEnd: 12.75 },
]

const GENERATED_DOM_VIDEO_INPUTS: DomVideoDecisionInput[] = (() => {
  const random = createSeededRandom(0xd0d0)
  return Array.from({ length: 400 }, () => {
    const sourceTime = pick(random, [0, 8.5, 10, 20.25, 40, 60])
    const domVideo =
      random() < 0.1
        ? null
        : makeDomVideo({
            readyState: pick(random, [0, 1, 2, 4]),
            videoWidth: pick(random, [0, 640, 1920]),
            currentTime: sourceTime + pick(random, [-2, -0.05, 0, 0.05, 2]),
            playbackRate: pick(random, [0.5, 1, 2]),
            transitionSourceRamp: pick(random, [undefined, '0', '1']),
            transitionHold: pick(random, [undefined, '1']),
          })
    return {
      domVideo,
      sourceTimeRamp: pick(random, RAMPS),
      frame: pick(random, [0, 9, 10, 11, 12.5, 12.75, 13, 39, 40, 41]),
      sourceTime,
      itemSpeed: pick(random, [undefined, 0.5, 1, 2]),
    }
  })
})()

describe('parseGpuColor', () => {
  it('parses the authored color formats the shape pipeline accepts', () => {
    expect(parseGpuColor('#fff')).toEqual([1, 1, 1, 1])
    expect(parseGpuColor('#112233')).toEqual([17 / 255, 34 / 255, 51 / 255, 1])
    expect(parseGpuColor('#11223344')).toEqual([17 / 255, 34 / 255, 51 / 255, 68 / 255])
    expect(parseGpuColor(' rgb(255, 0, 0) ')).toEqual([1, 0, 0, 1])
    expect(parseGpuColor('rgba(0, 255, 0, 0.5)')).toEqual([0, 1, 0, 0.5])
    expect(parseGpuColor('rgb(50%, 0%, 100%)')).toEqual([0.5, 0, 1, 1])
    expect(parseGpuColor('red')).toBeNull()
    expect(parseGpuColor('rgb(1, 2)')).toBeNull()
    expect(parseGpuColor('rgb(a, b, c)')).toBeNull()
  })

  it('agrees with the parser it replaced across generated colors', () => {
    const colors = [...COLOR_STRINGS, ...OPTIONAL_COLORS, '#0f0', 'rgba(1,2,3,4,5)']
    for (const color of colors) {
      if (color === undefined) continue
      expect(parseGpuColor(color)).toEqual(parseGpuColorVerbatim(color))
    }
  })
})

describe('resolveGpuShapeStyle', () => {
  it('matches the inline policy it replaced across generated shapes', () => {
    for (const shape of GENERATED_SHAPES) {
      expect(resolveGpuShapeStyle(shape)).toEqual(referenceGpuShapeStyle(shape))
    }
  })

  it('covers both the renderable and the unrenderable-fill shapes', () => {
    expect(GENERATED_SHAPES.some((shape) => resolveGpuShapeStyle(shape) === null)).toBe(true)
    expect(GENERATED_SHAPES.some((shape) => resolveGpuShapeStyle(shape) !== null)).toBe(true)
  })

  it('keeps a disabled fill transparent but preserves its RGB', () => {
    const style = resolveGpuShapeStyle({ ...BASE_SHAPE, fillColor: '#123456', fillEnabled: false })
    expect(style?.fillColor).toEqual([0x12 / 255, 0x34 / 255, 0x56 / 255, 0])
  })

  it('keeps the stroke of an open path while its fill is suppressed', () => {
    const style = resolveGpuShapeStyle({
      ...BASE_SHAPE,
      shapeType: 'path',
      pathClosed: false,
      strokeWidth: 4,
      strokeColor: '#ff0000',
    })
    expect(style?.fillColor?.[3]).toBe(0)
    expect(style?.strokeColor).toEqual([1, 0, 0, 1])
  })

  it('rejects a shape whose fill color cannot be parsed', () => {
    expect(resolveGpuShapeStyle({ ...BASE_SHAPE, fillColor: 'not-a-color' })).toBeNull()
  })

  it('rejects a linear fill whose gradient end color cannot be parsed', () => {
    expect(
      resolveGpuShapeStyle({
        ...BASE_SHAPE,
        fillType: 'linear',
        fillColor: '#123456',
        gradientEndColor: 'not-a-color',
      }),
    ).toBeNull()
  })

  it('detects a drifted policy, so the oracle comparison can fail', () => {
    const drifted = GENERATED_SHAPES.filter(
      (shape) => !sameStyle(brokenGpuShapeStyle(shape), referenceGpuShapeStyle(shape)),
    )
    expect(drifted.length).toBeGreaterThan(0)
  })
})

describe('resolveGpuShapeSourceItem', () => {
  it('matches the inline animated/scaled derivation it replaced', () => {
    const items = [BASE_SHAPE, { ...BASE_SHAPE, from: 12 }]
    const keyframeSets = [undefined, TAPER_KEYFRAMES]
    const canvases = [FULL_CANVAS, PREVIEW_CANVAS, EXPRESSION_CANVAS]
    for (const item of items) {
      for (const keyframes of keyframeSets) {
        for (const canvas of canvases) {
          for (const frame of [0, 12, 24, 30, 60, 72]) {
            expect(resolveGpuShapeSourceItem(item, keyframes, frame, canvas)).toEqual(
              referenceGpuShapeSourceItem(item, keyframes, frame, canvas),
            )
          }
        }
      }
    }
  })

  it('interpolates keyframes against the item-relative frame', () => {
    const atItemStart = resolveGpuShapeSourceItem(
      { ...BASE_SHAPE, from: 24 },
      TAPER_KEYFRAMES,
      24,
      FULL_CANVAS,
    )
    const atItemMidpoint = resolveGpuShapeSourceItem(
      { ...BASE_SHAPE, from: 24 },
      TAPER_KEYFRAMES,
      54,
      FULL_CANVAS,
    )
    expect(atItemStart.taperStartWidth).toBe(100)
    expect(atItemMidpoint.taperStartWidth).toBe(130)
  })

  it('scales the shape stroke into the render canvas', () => {
    const scaled = resolveGpuShapeSourceItem(
      { ...BASE_SHAPE, strokeWidth: 8 },
      undefined,
      0,
      PREVIEW_CANVAS,
    )
    expect(scaled.strokeWidth).toBe(4)
  })

  it('detects a derivation that resolves keyframes on the composition frame', () => {
    const item = { ...BASE_SHAPE, from: 24 }
    const broken = (frame: number) =>
      resolveAnimatedShapeItem(item, TAPER_KEYFRAMES, frame) as ShapeItem
    const drifted = [24, 54].some(
      (frame) =>
        JSON.stringify(broken(frame)) !==
        JSON.stringify(resolveGpuShapeSourceItem(item, TAPER_KEYFRAMES, frame, FULL_CANVAS)),
    )
    expect(drifted).toBe(true)
  })
})

describe('resolveGpuDomVideoDrawDecision', () => {
  it('matches the inline ramp / drift decision it replaced', () => {
    for (const input of GENERATED_DOM_VIDEO_INPUTS) {
      expect(resolveGpuDomVideoDrawDecision(input)).toEqual(referenceGpuDomVideoDrawDecision(input))
    }
  })

  it('covers both drawn and rejected DOM video candidates', () => {
    expect(
      GENERATED_DOM_VIDEO_INPUTS.some((input) => resolveGpuDomVideoDrawDecision(input).shouldDraw),
    ).toBe(true)
    expect(
      GENERATED_DOM_VIDEO_INPUTS.some((input) => !resolveGpuDomVideoDrawDecision(input).shouldDraw),
    ).toBe(true)
  })

  it('distrusts a DOM video whose clock a ramped span did not drive', () => {
    const input: DomVideoDecisionInput = {
      domVideo: makeDomVideo({ currentTime: 20, transitionSourceRamp: undefined }),
      sourceTimeRamp: { rampStart: 10, rampEnd: 40 },
      frame: 20,
      sourceTime: 20,
      itemSpeed: 1,
    }
    expect(resolveGpuDomVideoDrawDecision(input).shouldDraw).toBe(false)
    expect(
      resolveGpuDomVideoDrawDecision({
        ...input,
        domVideo: makeDomVideo({ currentTime: 20, transitionSourceRamp: '1' }),
      }).shouldDraw,
    ).toBe(true)
  })

  it('detects a decision that trusts the ramp unconditionally', () => {
    const drifted = GENERATED_DOM_VIDEO_INPUTS.filter(
      (input) =>
        brokenGpuDomVideoDrawDecision(input).shouldDraw !==
        resolveGpuDomVideoDrawDecision(input).shouldDraw,
    )
    expect(drifted.length).toBeGreaterThan(0)
  })
})

describe('canUseGpuVideoExtractorSource', () => {
  it('matches the inline MediaBunny extractor gate', () => {
    for (const supportsMediabunny of [true, false]) {
      for (const mediabunnyDisabled of [true, false]) {
        expect(canUseGpuVideoExtractorSource({ supportsMediabunny, mediabunnyDisabled })).toBe(
          supportsMediabunny && !mediabunnyDisabled,
        )
      }
    }
  })
})
