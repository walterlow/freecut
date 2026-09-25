/**
 * Pure selection policy for the GPU media-participant source path: the
 * fill / gradient / stroke colors the GPU shape pipeline receives, and which
 * video source a participant resolves to (synchronized DOM video or the
 * MediaBunny frame extractor).
 *
 * Resource owners deliberately stay in `gpu.ts`: the text branch mutates the
 * glyph-texture cache, the sub-composition branch renders and owns textures,
 * and the captured-frame branch transfers a decoded frame's ownership.
 */

import type { ShapeItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { resolveShapeLinearGradient } from '@/shared/graphics/shapes/linear-gradient'
import { resolveAnimatedShapeItem } from '@/runtime/renderer/deps/keyframes-contract'
import { getLogicalCanvasSize, scaleShapeItemForCanvas } from '../canvas-render-scale'
import {
  resolvePreviewDomVideoDrawDecision,
  type PreviewDomVideoDrawDecision,
} from '../frame-source-policy'
import type { CanvasSettings } from './types'

export type GpuShapeColor = [number, number, number, number]

export interface GpuShapeStyle {
  fillColor: GpuShapeColor
  gradientEndColor?: GpuShapeColor
  gradientAngleRad?: number
  strokeColor?: GpuShapeColor
}

export type GpuSourceTimeRamp = { rampStart: number; rampEnd: number }

export function parseGpuColor(color: string): GpuShapeColor | null {
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
 * An open custom path cannot be filled, and stroke-only shapes are the norm
 * for them; every other shape keeps its authored fill setting.
 */
export function isGpuShapeFillEnabled(shape: ShapeItem): boolean {
  if (shape.shapeType === 'path' && shape.pathClosed === false) return false
  return shape.fillEnabled ?? true
}

/** A disabled fill keeps its RGB and drops to transparent so the shader still blends. */
function applyGpuShapeFillAlpha(color: GpuShapeColor, fillEnabled: boolean): GpuShapeColor {
  if (fillEnabled) return color
  return [color[0], color[1], color[2], 0]
}

function resolveGpuShapeStrokeColor(shape: ShapeItem): GpuShapeColor | undefined {
  if (shape.strokeEnabled === false) return undefined
  if (!shape.strokeWidth || shape.strokeWidth <= 0) return undefined
  if (!shape.strokeColor) return undefined
  return parseGpuColor(shape.strokeColor) ?? undefined
}

/**
 * `null` means the GPU shape pipeline cannot render this shape's fill: the
 * start color (or, for a linear fill, the gradient's end color) is not a
 * color the shader can parse.
 */
export function resolveGpuShapeStyle(shape: ShapeItem): GpuShapeStyle | null {
  const linearGradient = resolveShapeLinearGradient(shape)
  const fillColor = parseGpuColor(linearGradient?.startColor ?? shape.fillColor)
  const gradientEndColor = linearGradient ? parseGpuColor(linearGradient.endColor) : undefined
  if (!fillColor) return null
  if (linearGradient && !gradientEndColor) return null
  const fillEnabled = isGpuShapeFillEnabled(shape)
  return {
    fillColor: applyGpuShapeFillAlpha(fillColor, fillEnabled),
    gradientEndColor: gradientEndColor
      ? applyGpuShapeFillAlpha(gradientEndColor, fillEnabled)
      : undefined,
    gradientAngleRad: linearGradient ? (linearGradient.angle * Math.PI) / 180 : undefined,
    strokeColor: resolveGpuShapeStrokeColor(shape),
  }
}

/**
 * The expression context only exists when the composition resolved both
 * same-composition providers; without them linked properties stay inert and
 * the canvas is never recomputed to logical space.
 */
function resolveGpuShapeExpressionContext(
  canvasSettings: CanvasSettings,
  frame: number,
): Parameters<typeof resolveAnimatedShapeItem>[3] {
  const { getExpressionItem, getExpressionKeyframes } = canvasSettings
  if (!getExpressionItem || !getExpressionKeyframes) return undefined
  return {
    globalFrame: frame,
    canvas: getLogicalCanvasSize(canvasSettings),
    getItem: getExpressionItem,
    getKeyframes: getExpressionKeyframes,
  }
}

/**
 * Shape properties are authored on the timeline, so keyframes resolve against
 * the item-relative frame while linked expressions stay on the composition
 * frame; the result is then scaled into the render canvas.
 */
export function resolveGpuShapeSourceItem(
  item: ShapeItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  canvasSettings: CanvasSettings,
): ShapeItem {
  return scaleShapeItemForCanvas(
    resolveAnimatedShapeItem(
      item,
      itemKeyframes,
      frame - item.from,
      resolveGpuShapeExpressionContext(canvasSettings, frame),
    ),
    canvasSettings,
  )
}

/** A source-time ramp maps the frame onto the source clock across an inclusive span. */
function isGpuSourceTimeRampActive(ramp: GpuSourceTimeRamp | undefined, frame: number): boolean {
  if (!ramp) return false
  if (frame < ramp.rampStart) return false
  return frame <= ramp.rampEnd
}

/**
 * While a source-time ramp is active the DOM video's clock is only trustworthy
 * if the transition itself drove it; otherwise the extractor must supply the
 * frame.
 */
function canUseSynchronizedTransitionDomVideo(
  hasActiveRamp: boolean,
  transitionSourceRampFlag: string | undefined,
): boolean {
  if (!hasActiveRamp) return true
  return transitionSourceRampFlag === '1'
}

/**
 * The transition drift/readiness decision for the DOM-video candidate, with the
 * source-time ramp downgrading a video the transition did not drive to "no
 * candidate at all".
 */
export function resolveGpuDomVideoDrawDecision(input: {
  domVideo: HTMLVideoElement | null
  sourceTimeRamp: GpuSourceTimeRamp | undefined
  frame: number
  sourceTime: number
  itemSpeed: number | undefined
}): PreviewDomVideoDrawDecision {
  const hasActiveRamp = isGpuSourceTimeRampActive(input.sourceTimeRamp, input.frame)
  const canUseSynchronizedDomVideo = canUseSynchronizedTransitionDomVideo(
    hasActiveRamp,
    input.domVideo?.dataset.transitionSourceRamp,
  )
  const domVideo = canUseSynchronizedDomVideo ? input.domVideo : null
  return resolvePreviewDomVideoDrawDecision({
    domVideo,
    sourceTime: input.sourceTime,
    speed: domVideo?.playbackRate ?? input.itemSpeed ?? 1,
    isRenderingTransition: true,
  })
}

/**
 * The extractor is only a legal fallback when the item is MediaBunny-backed and
 * that source has not been disabled for it.
 */
export function canUseGpuVideoExtractorSource(input: {
  supportsMediabunny: boolean
  mediabunnyDisabled: boolean
}): boolean {
  if (!input.supportsMediabunny) return false
  return !input.mediabunnyDisabled
}
