import type { ResolvedTransform } from '@/types/transform'
import type { AnimatableProperty } from '@/types/keyframe'
import type {
  MotionPreset,
  MotionPresetBuildContext,
  MotionPresetKeyframePayload,
} from './motion-presets'

export interface MotionGeneratorSettings {
  durationScale: number
  intensityScale: number
  staggerFrames: number
  triggerWaveColor?: string
}

const PROPERTY_MIN: Partial<Record<AnimatableProperty, number>> = {
  width: 1,
  height: 1,
  opacity: 0,
  cornerRadius: 0,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  cropSoftness: 0,
  fontSize: 1,
  lineHeight: 0,
  textPadding: 0,
  backgroundRadius: 0,
  textShadowBlur: 0,
  strokeWidth: 0,
}

const PROPERTY_MAX: Partial<Record<AnimatableProperty, number>> = {
  opacity: 1,
  cropLeft: 1,
  cropRight: 1,
  cropTop: 1,
  cropBottom: 1,
  cropSoftness: 1,
}

export const DEFAULT_MOTION_GENERATOR_SETTINGS: MotionGeneratorSettings = {
  durationScale: 1,
  intensityScale: 1,
  staggerFrames: 0,
  triggerWaveColor: '#2e6b8c',
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getAnchorValue(anchor: ResolvedTransform, property: AnimatableProperty): number | null {
  if (property in anchor) {
    const value = anchor[property as keyof ResolvedTransform]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  return null
}

function clampPropertyValue(property: AnimatableProperty, value: number): number {
  const min = PROPERTY_MIN[property]
  const max = PROPERTY_MAX[property]
  if (typeof min === 'number' && value < min) return min
  if (typeof max === 'number' && value > max) return max
  return value
}

function scaleValueAroundAnchor(
  payload: MotionPresetKeyframePayload,
  anchor: ResolvedTransform,
  intensityScale: number,
): MotionPresetKeyframePayload {
  const anchorValue = getAnchorValue(anchor, payload.property)
  if (anchorValue === null) return payload

  const value = anchorValue + (payload.value - anchorValue) * intensityScale
  return {
    ...payload,
    value: clampPropertyValue(payload.property, value),
  }
}

function retimeFrame(
  frame: number,
  preset: MotionPreset,
  ctx: MotionPresetBuildContext,
  durationScale: number,
  staggerFrames: number,
): number {
  const maxFrame = Math.max(0, ctx.durationInFrames - 1)
  const scale = clamp(durationScale, 0.25, 3)
  const stagger = Math.max(0, Math.round(staggerFrames))

  if (preset.category === 'exit') {
    const distanceFromEnd = maxFrame - frame
    return clamp(Math.round(maxFrame - distanceFromEnd * scale - stagger), 0, maxFrame)
  }

  return clamp(Math.round(frame * scale + stagger), 0, maxFrame)
}

function dedupeByPropertyFrame(
  payloads: MotionPresetKeyframePayload[],
): MotionPresetKeyframePayload[] {
  const byKey = new Map<string, MotionPresetKeyframePayload>()
  for (const payload of payloads) {
    byKey.set(`${payload.property}:${payload.frame}`, payload)
  }
  return Array.from(byKey.values()).sort((left, right) => {
    if (left.property !== right.property) return left.property.localeCompare(right.property)
    return left.frame - right.frame
  })
}

export function applyMotionGeneratorSettings(
  preset: MotionPreset,
  payloads: MotionPresetKeyframePayload[],
  ctx: MotionPresetBuildContext,
  settings: MotionGeneratorSettings = DEFAULT_MOTION_GENERATOR_SETTINGS,
  itemIndex = 0,
): MotionPresetKeyframePayload[] {
  const durationScale = clamp(settings.durationScale, 0.25, 3)
  const intensityScale = clamp(settings.intensityScale, 0, 2)
  const staggerFrames = Math.max(0, settings.staggerFrames) * Math.max(0, itemIndex)

  return dedupeByPropertyFrame(
    payloads.map((payload) => {
      const scaled = scaleValueAroundAnchor(payload, ctx.anchor, intensityScale)
      return {
        ...scaled,
        frame: retimeFrame(scaled.frame, preset, ctx, durationScale, staggerFrames),
      }
    }),
  )
}
