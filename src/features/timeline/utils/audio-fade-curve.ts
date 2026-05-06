import {
  AUDIO_FADE_CURVE_X_DEFAULT,
  AUDIO_FADE_CURVE_X_MAX,
  AUDIO_FADE_CURVE_X_MIN,
  clampAudioFadeCurve,
  clampAudioFadeCurveX,
  evaluateAudioFadeInCurve,
  evaluateAudioFadeOutCurve,
} from '@/shared/utils/audio-fade-curve'
import type { AudioFadeHandle } from './audio-fade'

const AUDIO_FADE_CURVE_PATH_SAMPLES = 24
const AUDIO_FADE_CURVE_EDGE_SNAP_PX = 6

export interface AudioFadeCurveControlPoint {
  x: number
  y: number
}

function formatPathValue(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function evaluateAudioFadeCurveAtProgress(
  handle: AudioFadeHandle,
  progress: number,
  curve: number | undefined,
  curveX: number | undefined,
): number {
  return handle === 'in'
    ? evaluateAudioFadeInCurve(progress, curve, curveX)
    : evaluateAudioFadeOutCurve(progress, curve, curveX)
}

export function getAudioFadeCurveControlPoint(params: {
  handle: AudioFadeHandle
  fadePixels: number
  clipWidthPixels: number
  curve: number | undefined
  curveX?: number
}): AudioFadeCurveControlPoint {
  const fadePixels = Math.max(0, Math.min(params.fadePixels, params.clipWidthPixels))
  const startX = params.handle === 'in' ? 0 : Math.max(0, params.clipWidthPixels - fadePixels)
  const endX = params.handle === 'in' ? fadePixels : params.clipWidthPixels
  const normalizedCurveX = clampAudioFadeCurveX(params.curveX)
  const absoluteX = startX + (endX - startX) * normalizedCurveX
  const curveValue = evaluateAudioFadeCurveAtProgress(
    params.handle,
    normalizedCurveX,
    params.curve,
    normalizedCurveX,
  )

  return {
    x: Math.max(Math.min(startX, endX), Math.min(Math.max(startX, endX), absoluteX)),
    y: Math.max(0, Math.min(100, 100 - curveValue * 100)),
  }
}

export function getAudioFadeCurvePath(params: {
  handle: AudioFadeHandle
  fadePixels: number
  clipWidthPixels: number
  curve: number | undefined
  curveX?: number
}): string {
  const fadePixels = Math.max(0, Math.min(params.fadePixels, params.clipWidthPixels))
  if (fadePixels <= 0) {
    return ''
  }

  const startX = params.handle === 'in' ? 0 : Math.max(0, params.clipWidthPixels - fadePixels)
  const endX = params.handle === 'in' ? fadePixels : params.clipWidthPixels
  const points: string[] = []

  for (let index = 0; index <= AUDIO_FADE_CURVE_PATH_SAMPLES; index += 1) {
    const progress = index / AUDIO_FADE_CURVE_PATH_SAMPLES
    const x = startX + (endX - startX) * progress
    const curveValue = evaluateAudioFadeCurveAtProgress(
      params.handle,
      progress,
      params.curve,
      params.curveX,
    )
    const y = 100 - curveValue * 100
    points.push(`${formatPathValue(x)} ${formatPathValue(y)}`)
  }

  if (params.handle === 'in') {
    return `M 0 0 L ${formatPathValue(fadePixels)} 0 L ${points.slice().reverse().join(' L ')} Z`
  }

  return `M ${formatPathValue(startX)} 0 L ${points.join(' L ')} L ${formatPathValue(params.clipWidthPixels)} 0 Z`
}

export function getAudioFadeCurveFromOffset(params: {
  handle: AudioFadeHandle
  pointerOffsetX: number
  pointerOffsetY: number
  fadePixels: number
  clipWidthPixels: number
  rowHeight: number
}): { curve: number; curveX: number } {
  if (!Number.isFinite(params.rowHeight) || params.rowHeight <= 0 || params.fadePixels <= 0) {
    return { curve: 0, curveX: AUDIO_FADE_CURVE_X_DEFAULT }
  }

  const fadePixels = Math.max(0, Math.min(params.fadePixels, params.clipWidthPixels))
  const startX = params.handle === 'in' ? 0 : Math.max(0, params.clipWidthPixels - fadePixels)
  const endX = params.handle === 'in' ? fadePixels : params.clipWidthPixels
  const edgeSnapDistance = Math.min(AUDIO_FADE_CURVE_EDGE_SNAP_PX, Math.max(0, (endX - startX) / 2))

  let curveX: number
  if (params.pointerOffsetX <= startX + edgeSnapDistance) {
    curveX = AUDIO_FADE_CURVE_X_MIN
  } else if (params.pointerOffsetX >= endX - edgeSnapDistance) {
    curveX = AUDIO_FADE_CURVE_X_MAX
  } else {
    curveX = clampAudioFadeCurveX((params.pointerOffsetX - startX) / Math.max(1, endX - startX))
  }
  // Dampen curve sensitivity near edges. The power curve model amplifies
  // small curve changes when curveX is near 0 or 1, so we raise the raw
  // curve through a higher exponent near the edges to require more pointer
  // travel for the same visual change.
  const edgeDistance = Math.min(curveX, 1 - curveX)
  const edgeDampingRamp = Math.min(1, edgeDistance * 5) // 0 at edge, 1 at curveX ≥ 0.2
  const edgeDampingExponent = 1 + (1 - edgeDampingRamp) * 2 // 3 at edge, 1 past 0.2

  const y = Math.max(0, Math.min(100, (params.pointerOffsetY / params.rowHeight) * 100))
  const startY = params.handle === 'in' ? 100 : 0
  const endY = params.handle === 'in' ? 0 : 100
  const linearY = startY + (endY - startY) * curveX
  if (y <= linearY) {
    const range = Math.max(1, linearY)
    const raw = (linearY - y) / range
    return { curve: clampAudioFadeCurve(Math.pow(raw, edgeDampingExponent)), curveX }
  }

  const range = Math.max(1, 100 - linearY)
  const raw = (y - linearY) / range
  return { curve: clampAudioFadeCurve(-Math.pow(raw, edgeDampingExponent)), curveX }
}
