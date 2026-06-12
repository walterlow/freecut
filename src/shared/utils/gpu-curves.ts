import { evaluateMonotoneCurve } from './curve-spline'

export type GpuCurvesChannelKey = 'master' | 'red' | 'green' | 'blue'

export interface GpuCurvesControlPoint {
  x: number
  y: number
}

export interface GpuCurvesChannelControl {
  shadow: GpuCurvesControlPoint
  highlight: GpuCurvesControlPoint
}

type EffectParams = Record<string, number | boolean | string>

const DEFAULT_POINT_XS = {
  shadow: 0.25,
  highlight: 0.75,
} as const

export const GPU_CURVES_CHANNELS: GpuCurvesChannelKey[] = ['master', 'red', 'green', 'blue']
const GPU_CURVES_POINT_MIN_X = 0.02
const GPU_CURVES_POINT_MAX_X = 0.98
export const GPU_CURVES_POINT_MIN_GAP = 0.04

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function asFiniteNumber(value: number | boolean | string | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getLegacyChannelOffset(
  params: EffectParams,
  channel: Exclude<GpuCurvesChannelKey, 'master'>,
): number {
  const value = asFiniteNumber(params[channel], 0)
  return clamp(value / 200, -0.5, 0.5)
}

function applyLegacyShadows(c: number, amount: number): number {
  const shadow = 1 - c
  return c + shadow * shadow * amount * 0.5
}

function applyLegacyMidtones(c: number, amount: number): number {
  const mid = 4 * c * (1 - c)
  return c + mid * amount * 0.25
}

function applyLegacyHighlights(c: number, amount: number): number {
  return c + c * c * amount * 0.5
}

function applyLegacyContrast(c: number, amount: number): number {
  return (c - 0.5) * (1 + amount) + 0.5
}

function computeLegacyMasterCurve(params: EffectParams, input: number): number {
  const shadows = asFiniteNumber(params.shadows, 0) / 100
  const midtones = asFiniteNumber(params.midtones, 0) / 100
  const highlights = asFiniteNumber(params.highlights, 0) / 100
  const contrast = asFiniteNumber(params.contrast, 0) / 100

  let value = input
  value = applyLegacyShadows(value, shadows)
  value = applyLegacyMidtones(value, midtones)
  value = applyLegacyHighlights(value, highlights)
  value = applyLegacyContrast(value, contrast)
  return clamp(value, 0, 1)
}

export function getGpuCurvesChannelParamKeys(channel: GpuCurvesChannelKey) {
  const prefix = channel.charAt(0).toUpperCase() + channel.slice(1)
  return {
    shadowX: `${channel}ShadowX`,
    shadowY: `${channel}ShadowY`,
    highlightX: `${channel}HighlightX`,
    highlightY: `${channel}HighlightY`,
    prefix,
  } as const
}

export function getDefaultGpuCurvesChannelControl(): GpuCurvesChannelControl {
  return {
    shadow: { x: DEFAULT_POINT_XS.shadow, y: DEFAULT_POINT_XS.shadow },
    highlight: { x: DEFAULT_POINT_XS.highlight, y: DEFAULT_POINT_XS.highlight },
  }
}

function sanitizeGpuCurvesChannelControl(
  control: GpuCurvesChannelControl,
): GpuCurvesChannelControl {
  const defaultControl = getDefaultGpuCurvesChannelControl()

  let shadowX = clamp(
    asFiniteNumber(control.shadow.x, defaultControl.shadow.x),
    GPU_CURVES_POINT_MIN_X,
    GPU_CURVES_POINT_MAX_X,
  )
  let highlightX = clamp(
    asFiniteNumber(control.highlight.x, defaultControl.highlight.x),
    GPU_CURVES_POINT_MIN_X,
    GPU_CURVES_POINT_MAX_X,
  )

  if (shadowX > highlightX) {
    ;[shadowX, highlightX] = [highlightX, shadowX]
  }

  if (highlightX - shadowX < GPU_CURVES_POINT_MIN_GAP) {
    const midpoint = clamp(
      (shadowX + highlightX) / 2,
      GPU_CURVES_POINT_MIN_X + GPU_CURVES_POINT_MIN_GAP / 2,
      GPU_CURVES_POINT_MAX_X - GPU_CURVES_POINT_MIN_GAP / 2,
    )
    shadowX = midpoint - GPU_CURVES_POINT_MIN_GAP / 2
    highlightX = midpoint + GPU_CURVES_POINT_MIN_GAP / 2
  }

  return {
    shadow: {
      x: shadowX,
      y: clamp(asFiniteNumber(control.shadow.y, defaultControl.shadow.y), 0, 1),
    },
    highlight: {
      x: highlightX,
      y: clamp(asFiniteNumber(control.highlight.y, defaultControl.highlight.y), 0, 1),
    },
  }
}

export function buildGpuCurvesChannelPoints(control: GpuCurvesChannelControl) {
  const sanitized = sanitizeGpuCurvesChannelControl(control)
  return [{ x: 0, y: 0 }, sanitized.shadow, sanitized.highlight, { x: 1, y: 1 }]
}

export function readGpuCurvesChannelControl(
  params: EffectParams,
  channel: GpuCurvesChannelKey,
): GpuCurvesChannelControl {
  const keys = getGpuCurvesChannelParamKeys(channel)
  const hasExplicitPoints = [keys.shadowX, keys.shadowY, keys.highlightX, keys.highlightY].some(
    (key) => typeof params[key] === 'number' && Number.isFinite(params[key] as number),
  )

  if (hasExplicitPoints) {
    return sanitizeGpuCurvesChannelControl({
      shadow: {
        x: asFiniteNumber(params[keys.shadowX], DEFAULT_POINT_XS.shadow),
        y: asFiniteNumber(params[keys.shadowY], DEFAULT_POINT_XS.shadow),
      },
      highlight: {
        x: asFiniteNumber(params[keys.highlightX], DEFAULT_POINT_XS.highlight),
        y: asFiniteNumber(params[keys.highlightY], DEFAULT_POINT_XS.highlight),
      },
    })
  }

  if (channel === 'master') {
    return sanitizeGpuCurvesChannelControl({
      shadow: {
        x: DEFAULT_POINT_XS.shadow,
        y: computeLegacyMasterCurve(params, DEFAULT_POINT_XS.shadow),
      },
      highlight: {
        x: DEFAULT_POINT_XS.highlight,
        y: computeLegacyMasterCurve(params, DEFAULT_POINT_XS.highlight),
      },
    })
  }

  const offset = getLegacyChannelOffset(params, channel)
  return sanitizeGpuCurvesChannelControl({
    shadow: {
      x: DEFAULT_POINT_XS.shadow,
      y: DEFAULT_POINT_XS.shadow + offset,
    },
    highlight: {
      x: DEFAULT_POINT_XS.highlight,
      y: DEFAULT_POINT_XS.highlight + offset,
    },
  })
}

export function toGpuCurvesChannelParamUpdates(
  channel: GpuCurvesChannelKey,
  control: GpuCurvesChannelControl,
): Record<string, number> {
  const sanitized = sanitizeGpuCurvesChannelControl(control)
  const keys = getGpuCurvesChannelParamKeys(channel)
  return {
    [keys.shadowX]: sanitized.shadow.x,
    [keys.shadowY]: sanitized.shadow.y,
    [keys.highlightX]: sanitized.highlight.x,
    [keys.highlightY]: sanitized.highlight.y,
  }
}

export function getGpuCurvesDefaultParams(): Record<string, number> {
  return GPU_CURVES_CHANNELS.reduce<Record<string, number>>((acc, channel) => {
    Object.assign(acc, toGpuCurvesChannelParamUpdates(channel, getDefaultGpuCurvesChannelControl()))
    return acc
  }, {})
}

export function getGpuCurvesDraftParams(params: EffectParams): Record<string, number> {
  return GPU_CURVES_CHANNELS.reduce<Record<string, number>>((acc, channel) => {
    Object.assign(
      acc,
      toGpuCurvesChannelParamUpdates(channel, readGpuCurvesChannelControl(params, channel)),
    )
    return acc
  }, {})
}

// --- Multi-point curves -----------------------------------------------------
//
// Curves historically had two draggable points per channel (shadow/highlight,
// stored as 16 numeric params). Channels now support arbitrary control points
// stored as a JSON param per channel (`masterPoints`, `redPoints`, ...). When
// the JSON param is empty, the channel falls back to the legacy 2-point
// params, so existing projects (and keyframed 2-point curves) keep working.

export const GPU_CURVES_LUT_WIDTH = 256
export const GPU_CURVES_MAX_POINTS = 16

export function getGpuCurvesPointsParamKey(channel: GpuCurvesChannelKey): string {
  return `${channel}Points`
}

export function serializeGpuCurvesChannelPoints(points: GpuCurvesControlPoint[]): string {
  return JSON.stringify(points.map((point) => [point.x, point.y]))
}

/** Sort by x, clamp to [0,1], enforce a minimum x gap, cap the point count. */
export function sanitizeGpuCurvesChannelPoints(
  points: GpuCurvesControlPoint[],
): GpuCurvesControlPoint[] {
  const cleaned = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }))
    .sort((a, b) => a.x - b.x)
    .slice(0, GPU_CURVES_MAX_POINTS)

  const result: GpuCurvesControlPoint[] = []
  for (const point of cleaned) {
    const previous = result[result.length - 1]
    if (previous && point.x - previous.x < GPU_CURVES_POINT_MIN_GAP / 2) continue
    result.push(point)
  }

  if (result.length < 2) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
  }
  return result
}

function parseGpuCurvesChannelPoints(raw: string): GpuCurvesControlPoint[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const points: GpuCurvesControlPoint[] = []
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length < 2) return null
      const [x, y] = entry
      if (typeof x !== 'number' || typeof y !== 'number') return null
      points.push({ x, y })
    }
    return points.length >= 2 ? sanitizeGpuCurvesChannelPoints(points) : null
  } catch {
    return null
  }
}

/**
 * The channel's full control point list (endpoints included). Prefers the
 * multi-point JSON param; falls back to the legacy 2-point controls.
 */
export function readGpuCurvesChannelPoints(
  params: EffectParams,
  channel: GpuCurvesChannelKey,
): GpuCurvesControlPoint[] {
  const raw = params[getGpuCurvesPointsParamKey(channel)]
  if (typeof raw === 'string' && raw.length > 0) {
    const points = parseGpuCurvesChannelPoints(raw)
    if (points) return points
  }
  return buildGpuCurvesChannelPoints(readGpuCurvesChannelControl(params, channel))
}

/** True when the channel's points are the identity line. */
export function isGpuCurvesChannelIdentity(points: GpuCurvesControlPoint[]): boolean {
  return points.every((point) => Math.abs(point.y - point.x) < 0.0005)
}

export function evaluateGpuCurvesEffectChannel(
  params: EffectParams,
  channel: GpuCurvesChannelKey,
  input: number,
): number {
  const masterValue = evaluateMonotoneCurve(readGpuCurvesChannelPoints(params, 'master'), input)
  if (channel === 'master') {
    return masterValue
  }
  return evaluateMonotoneCurve(readGpuCurvesChannelPoints(params, channel), masterValue)
}

/**
 * Bake the combined per-channel transfer functions into a 256x1 rgba8 LUT:
 * texel.r/g/b = red/green/blue(master(x)), sampled in the curves shader.
 */
export function buildGpuCurvesLutData(params: EffectParams): Uint8Array {
  const width = GPU_CURVES_LUT_WIDTH
  const masterPoints = readGpuCurvesChannelPoints(params, 'master')
  const redPoints = readGpuCurvesChannelPoints(params, 'red')
  const greenPoints = readGpuCurvesChannelPoints(params, 'green')
  const bluePoints = readGpuCurvesChannelPoints(params, 'blue')

  const data = new Uint8Array(width * 4)
  for (let i = 0; i < width; i++) {
    const x = i / (width - 1)
    const master = evaluateMonotoneCurve(masterPoints, x)
    data[i * 4] = Math.round(clamp(evaluateMonotoneCurve(redPoints, master), 0, 1) * 255)
    data[i * 4 + 1] = Math.round(clamp(evaluateMonotoneCurve(greenPoints, master), 0, 1) * 255)
    data[i * 4 + 2] = Math.round(clamp(evaluateMonotoneCurve(bluePoints, master), 0, 1) * 255)
    data[i * 4 + 3] = 255
  }
  return data
}

/** Cheap change-detection key over every param the LUT bake depends on. */
export function getGpuCurvesLutKey(params: EffectParams): string {
  const parts: Array<string | number> = []
  for (const channel of GPU_CURVES_CHANNELS) {
    const keys = getGpuCurvesChannelParamKeys(channel)
    parts.push(
      asFiniteNumber(params[keys.shadowX], -1),
      asFiniteNumber(params[keys.shadowY], -1),
      asFiniteNumber(params[keys.highlightX], -1),
      asFiniteNumber(params[keys.highlightY], -1),
      typeof params[getGpuCurvesPointsParamKey(channel)] === 'string'
        ? (params[getGpuCurvesPointsParamKey(channel)] as string)
        : '',
    )
  }
  return parts.join('|')
}
