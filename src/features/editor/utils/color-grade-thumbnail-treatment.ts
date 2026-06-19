import type { CSSProperties } from 'react'
import type { ItemEffect } from '@/types/effects'
import { getGpuEffectDefaultParams, isColorGradeEffectType } from '@/infrastructure/gpu-effects'
import {
  GPU_CURVES_CHANNELS,
  readGpuCurvesChannelControl,
  type GpuCurvesChannelKey,
} from '@/shared/utils/gpu-curves'

type EffectParams = Record<string, number | boolean | string>

export interface ColorGradeThumbnailTreatment {
  hasGrade: boolean
  imageStyle: CSSProperties
  overlayStyle: CSSProperties | null
}

interface TreatmentState {
  brightness: number
  contrast: number
  saturate: number
  hueRotate: number
  sepia: number
  grayscale: number
  invert: number
  overlays: Array<{ hue: number; alpha: number }>
}

const DEFAULT_TREATMENT: ColorGradeThumbnailTreatment = {
  hasGrade: false,
  imageStyle: {},
  overlayStyle: null,
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function readNumber(params: EffectParams, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getParams(type: string, params: EffectParams): EffectParams {
  return { ...getGpuEffectDefaultParams(type), ...params }
}

function addHueOverlay(state: TreatmentState, hue: number, alpha: number): void {
  const clampedAlpha = clamp(alpha, 0, 0.45)
  if (clampedAlpha < 0.01) return
  state.overlays.push({ hue: ((hue % 360) + 360) % 360, alpha: clampedAlpha })
}

function applyTemperatureTint(
  state: TreatmentState,
  temperature: number,
  tint: number,
  scale: number,
): void {
  if (Math.abs(temperature) > 0.001) {
    addHueOverlay(state, temperature > 0 ? 34 : 210, Math.abs(temperature) * scale)
  }
  if (Math.abs(tint) > 0.001) {
    addHueOverlay(state, tint > 0 ? 315 : 125, Math.abs(tint) * scale)
  }
}

function applyWheelsEffect(state: TreatmentState, params: EffectParams): void {
  const exposure = readNumber(params, 'exposure', 0)
  const lift = readNumber(params, 'lift', 0)
  const offset = readNumber(params, 'offset', 0)
  const gain = readNumber(params, 'gain', 1)
  const gamma = readNumber(params, 'gamma', 1)
  const blackPoint = readNumber(params, 'blackPoint', 0)
  const whitePoint = readNumber(params, 'whitePoint', 1)

  state.brightness *= clamp(
    Math.pow(2, exposure) *
      (1 + lift * 0.28 + offset * 0.18) *
      (1 + (gain - 1) * 0.12) *
      (1 + (gamma - 1) * 0.08),
    0.12,
    4,
  )
  state.contrast *= clamp(readNumber(params, 'contrast', 1), 0.1, 3)
  state.contrast *= clamp(1 / Math.max(0.08, whitePoint - blackPoint), 0.35, 3)
  state.saturate *= clamp(
    1 + readNumber(params, 'saturation', 0) / 100 + readNumber(params, 'colorBoost', 0) / 150,
    0,
    4,
  )
  state.hueRotate += (readNumber(params, 'hue', 50) - 50) * 3.6
  state.brightness *= clamp(
    1 + (readNumber(params, 'shadows', 0) + readNumber(params, 'highlights', 0)) / 360,
    0.35,
    2,
  )

  applyTemperatureTint(
    state,
    readNumber(params, 'temperature', 0),
    readNumber(params, 'tint', 0),
    0.0024,
  )
  addHueOverlay(
    state,
    readNumber(params, 'offsetHue', 0),
    readNumber(params, 'offsetAmount', 0) * 0.22,
  )
  addHueOverlay(
    state,
    readNumber(params, 'shadowsHue', 0),
    readNumber(params, 'shadowsAmount', 0) * 0.09,
  )
  addHueOverlay(
    state,
    readNumber(params, 'midtonesHue', 0),
    readNumber(params, 'midtonesAmount', 0) * 0.12,
  )
  addHueOverlay(
    state,
    readNumber(params, 'highlightsHue', 0),
    readNumber(params, 'highlightsAmount', 0) * 0.09,
  )
}

function getCurveDelta(params: EffectParams, channel: GpuCurvesChannelKey): number {
  const control = readGpuCurvesChannelControl(params, channel)
  return control.shadow.y - control.shadow.x + control.highlight.y - control.highlight.x
}

function applyCurvesEffect(state: TreatmentState, params: EffectParams): void {
  const masterDelta = getCurveDelta(params, 'master')
  state.brightness *= clamp(1 + masterDelta * 0.45, 0.25, 2.5)
  state.contrast *= clamp(
    1 + (readGpuCurvesChannelControl(params, 'master').highlight.y - 0.75) * 1.2,
    0.3,
    2.6,
  )

  const channelDeltas = GPU_CURVES_CHANNELS.filter(
    (channel): channel is Exclude<GpuCurvesChannelKey, 'master'> => channel !== 'master',
  ).map((channel) => [channel, getCurveDelta(params, channel)] as const)
  const strongest = channelDeltas.toSorted((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]
  if (!strongest || Math.abs(strongest[1]) < 0.025) return

  const hueByChannel = {
    red: strongest[1] > 0 ? 0 : 180,
    green: strongest[1] > 0 ? 120 : 300,
    blue: strongest[1] > 0 ? 230 : 45,
  } satisfies Record<Exclude<GpuCurvesChannelKey, 'master'>, number>
  addHueOverlay(state, hueByChannel[strongest[0]], Math.abs(strongest[1]) * 0.2)
}

function applyGenericColorEffect(state: TreatmentState, type: string, params: EffectParams): void {
  switch (type) {
    case 'gpu-brightness':
      state.brightness *= clamp(1 + readNumber(params, 'amount', 0), 0, 3)
      break
    case 'gpu-contrast':
      state.contrast *= clamp(readNumber(params, 'amount', 1), 0, 3)
      break
    case 'gpu-exposure':
      state.brightness *= clamp(
        Math.pow(2, readNumber(params, 'exposure', 0)) + readNumber(params, 'offset', 0),
        0,
        4,
      )
      state.brightness *= clamp(1 + (readNumber(params, 'gamma', 1) - 1) * 0.1, 0.5, 1.6)
      break
    case 'gpu-hue-shift':
      state.hueRotate += readNumber(params, 'shift', 0) * 360
      break
    case 'gpu-saturation':
      state.saturate *= clamp(readNumber(params, 'amount', 1), 0, 4)
      break
    case 'gpu-temperature':
      applyTemperatureTint(
        state,
        readNumber(params, 'temperature', 0),
        readNumber(params, 'tint', 0),
        0.24,
      )
      break
    case 'gpu-grayscale':
      state.grayscale = clamp(state.grayscale + readNumber(params, 'amount', 1), 0, 1)
      break
    case 'gpu-sepia':
      state.sepia = clamp(state.sepia + readNumber(params, 'amount', 1), 0, 1)
      break
    case 'gpu-invert':
      state.invert = 1
      break
    case 'gpu-levels': {
      const inputBlack = readNumber(params, 'inputBlack', 0)
      const inputWhite = readNumber(params, 'inputWhite', 1)
      state.contrast *= clamp(1 / Math.max(0.08, inputWhite - inputBlack), 0.25, 3)
      state.brightness *= clamp(
        readNumber(params, 'outputWhite', 1) - readNumber(params, 'outputBlack', 0),
        0.1,
        2,
      )
      break
    }
  }
}

function buildOverlayStyle(overlays: TreatmentState['overlays']): CSSProperties | null {
  if (overlays.length === 0) return null
  return {
    background: overlays
      .map(
        ({ hue, alpha }) =>
          `linear-gradient(hsla(${Math.round(hue)}, 90%, 55%, ${alpha}), hsla(${Math.round(hue)}, 90%, 55%, ${alpha}))`,
      )
      .join(', '),
    mixBlendMode: 'color',
  }
}

export function resolveColorGradeThumbnailTreatment(
  effects: readonly ItemEffect[] | undefined,
): ColorGradeThumbnailTreatment {
  const gradeEffects = (effects ?? []).filter(
    (entry) =>
      entry.enabled &&
      entry.effect.type === 'gpu-effect' &&
      isColorGradeEffectType(entry.effect.gpuEffectType),
  )
  if (gradeEffects.length === 0) return DEFAULT_TREATMENT

  const state: TreatmentState = {
    brightness: 1,
    contrast: 1,
    saturate: 1,
    hueRotate: 0,
    sepia: 0,
    grayscale: 0,
    invert: 0,
    overlays: [],
  }

  for (const entry of gradeEffects) {
    if (entry.effect.type !== 'gpu-effect') continue
    const params = getParams(entry.effect.gpuEffectType, entry.effect.params)
    if (entry.effect.gpuEffectType === 'gpu-color-wheels') {
      applyWheelsEffect(state, params)
    } else if (entry.effect.gpuEffectType === 'gpu-curves') {
      applyCurvesEffect(state, params)
    } else {
      applyGenericColorEffect(state, entry.effect.gpuEffectType, params)
    }
  }

  const filter = [
    state.invert > 0 ? `invert(${Math.round(state.invert * 100)}%)` : null,
    state.grayscale > 0 ? `grayscale(${Math.round(state.grayscale * 100)}%)` : null,
    state.sepia > 0 ? `sepia(${Math.round(state.sepia * 100)}%)` : null,
    `brightness(${clamp(state.brightness, 0, 4).toFixed(3)})`,
    `contrast(${clamp(state.contrast, 0, 4).toFixed(3)})`,
    `saturate(${clamp(state.saturate, 0, 4).toFixed(3)})`,
    Math.abs(state.hueRotate) > 0.01 ? `hue-rotate(${Math.round(state.hueRotate)}deg)` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    hasGrade: true,
    imageStyle: { filter },
    overlayStyle: buildOverlayStyle(state.overlays),
  }
}
