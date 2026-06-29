import { getGpuEffect } from '@/infrastructure/gpu-effects'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'
import {
  buildEffectAnimatableProperty,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
  type ItemKeyframes,
} from '@/types/keyframe'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import {
  colorStringToKeyframeValue,
  interpolateColorKeyframesToHex,
  keyframeValueToHexColor,
} from './color-keyframes'
import { evaluateAudioPulseParams } from './trigger-wave-motion-layer'

/**
 * Procedural audio-pulse override for a trigger-wave param at a frame.
 * Returns null when the entry has no active pulse or the param isn't driven,
 * so callers fall through to keyframe/base resolution.
 */
function getAudioPulseParamOverride(
  effectEntry: ItemEffect,
  relativeFrame: number,
  paramKey: string,
): number | string | null {
  const modulation = effectEntry.audioPulse
  if (
    !modulation?.enabled ||
    effectEntry.effect.type !== 'gpu-effect' ||
    effectEntry.effect.gpuEffectType !== 'gpu-trigger-wave'
  ) {
    return null
  }

  const values = evaluateAudioPulseParams(modulation, relativeFrame)
  if (!values) return null

  switch (paramKey) {
    case 'strength':
      return values.strength
    case 'chroma':
      return values.chroma
    case 'phase':
      return values.phase
    case 'glowColor':
      return keyframeValueToHexColor(values.glowColor)
    default:
      return null
  }
}

const NON_ANIMATABLE_GPU_NUMBER_PARAMS: Record<string, ReadonlySet<string>> = {
  'gpu-gaussian-blur': new Set(['samples']),
  'gpu-motion-blur': new Set(['samples']),
  'gpu-radial-blur': new Set(['samples']),
  'gpu-zoom-blur': new Set(['samples']),
  'gpu-grain': new Set(['speed']),
  'gpu-glow': new Set(['rings', 'samplesPerRing']),
  'gpu-scanlines': new Set(['speed']),
  'gpu-color-glitch': new Set(['speed']),
}

function isGpuEffectParamVisible(
  gpuEffectType: string,
  effectParams: Record<string, number | boolean | string>,
  paramKey: string,
): boolean {
  switch (gpuEffectType) {
    case 'gpu-dither':
      if (paramKey === 'angle') return effectParams.mode === 'linear'
      if (paramKey === 'scale' || paramKey === 'offsetX' || paramKey === 'offsetY') {
        return effectParams.mode === 'radial'
      }
      return true
    case 'gpu-ascii':
      if (paramKey === 'textColor') return effectParams.matchSourceColor !== true
      if (paramKey === 'colorSaturation') return effectParams.matchSourceColor === true
      return true
    default:
      return true
  }
}

function isAnimatableGpuNumberParam(effect: GpuEffect, paramKey: string): boolean {
  return (
    typeof effect.params[paramKey] === 'number' &&
    !NON_ANIMATABLE_GPU_NUMBER_PARAMS[effect.gpuEffectType]?.has(paramKey)
  )
}

export function isAnimatableGpuColorParam(effect: GpuEffect, paramKey: string): boolean {
  const definition = getGpuEffect(effect.gpuEffectType)
  const param = definition?.params[paramKey]
  const value = effect.params[paramKey]
  return (
    param?.type === 'color' &&
    param.animatable === true &&
    typeof value === 'string' &&
    colorStringToKeyframeValue(value) !== null
  )
}

function isAnimatableGpuEffectParam(effect: GpuEffect, paramKey: string): boolean {
  return isAnimatableGpuNumberParam(effect, paramKey) || isAnimatableGpuColorParam(effect, paramKey)
}

function getNumericGpuEffectParamValue(effect: GpuEffect, paramKey: string): number | null {
  const rawValue = effect.params[paramKey]

  if (typeof rawValue === 'number') {
    return rawValue
  }

  return null
}

function getColorGpuEffectParamValue(effect: GpuEffect, paramKey: string): string | null {
  const rawValue = effect.params[paramKey]
  if (typeof rawValue !== 'string') {
    return null
  }

  return colorStringToKeyframeValue(rawValue) === null ? null : rawValue
}

function getKeyframedEffectParamKeys(
  effectEntry: ItemEffect,
  itemKeyframes: ItemKeyframes | undefined,
): string[] {
  if (effectEntry.effect.type !== 'gpu-effect' || !itemKeyframes) {
    return []
  }

  const keys = new Set<string>()
  for (const propertyKeyframes of itemKeyframes.properties) {
    const parsed = parseEffectAnimatableProperty(propertyKeyframes.property)
    if (
      parsed &&
      parsed.effectId === effectEntry.id &&
      parsed.gpuEffectType === effectEntry.effect.gpuEffectType
    ) {
      keys.add(parsed.paramKey)
    }
  }

  return [...keys]
}

export function getAnimatableEffectPropertiesForItem(item: TimelineItem): AnimatableProperty[] {
  if (!item.effects || item.effects.length === 0) {
    return []
  }

  const properties: AnimatableProperty[] = []

  for (const effectEntry of item.effects) {
    if (effectEntry.effect.type !== 'gpu-effect') {
      continue
    }

    const gpuEffect = effectEntry.effect

    for (const [paramKey, value] of Object.entries(gpuEffect.params)) {
      if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        !isAnimatableGpuEffectParam(gpuEffect, paramKey)
      ) {
        continue
      }

      if (!isGpuEffectParamVisible(gpuEffect.gpuEffectType, gpuEffect.params, paramKey)) {
        continue
      }

      properties.push(
        buildEffectAnimatableProperty(gpuEffect.gpuEffectType, effectEntry.id, paramKey),
      )
    }
  }

  return properties
}

export function getEffectPropertyBaseValue(
  item: TimelineItem,
  property: AnimatableProperty,
): number | null {
  const parsed = parseEffectAnimatableProperty(property)
  if (!parsed || !item.effects) {
    return null
  }

  const effectEntry = item.effects.find(
    (entry) =>
      entry.id === parsed.effectId &&
      entry.effect.type === 'gpu-effect' &&
      entry.effect.gpuEffectType === parsed.gpuEffectType,
  )
  if (!effectEntry || effectEntry.effect.type !== 'gpu-effect') {
    return null
  }

  if (
    !isGpuEffectParamVisible(
      effectEntry.effect.gpuEffectType,
      effectEntry.effect.params,
      parsed.paramKey,
    )
  ) {
    return null
  }

  if (isAnimatableGpuColorParam(effectEntry.effect, parsed.paramKey)) {
    const value = getColorGpuEffectParamValue(effectEntry.effect, parsed.paramKey)
    return value === null ? null : colorStringToKeyframeValue(value)
  }

  if (!isAnimatableGpuNumberParam(effectEntry.effect, parsed.paramKey)) {
    return null
  }

  return getNumericGpuEffectParamValue(effectEntry.effect, parsed.paramKey)
}

export function getResolvedAnimatedEffectParamValue(
  effectEntry: ItemEffect,
  itemKeyframes: ItemKeyframes | undefined,
  relativeFrame: number,
  paramKey: string,
): number | string | null {
  if (effectEntry.effect.type !== 'gpu-effect') {
    return null
  }

  const gpuEffect = effectEntry.effect

  // Procedural audio-pulse takes precedence over keyframes/base for its params.
  const pulseOverride = getAudioPulseParamOverride(effectEntry, relativeFrame, paramKey)
  if (pulseOverride !== null) {
    return pulseOverride
  }

  if (isAnimatableGpuColorParam(gpuEffect, paramKey)) {
    const baseValue = getColorGpuEffectParamValue(gpuEffect, paramKey)
    if (baseValue === null) {
      return null
    }

    if (!isGpuEffectParamVisible(gpuEffect.gpuEffectType, gpuEffect.params, paramKey)) {
      return baseValue
    }

    const property = buildEffectAnimatableProperty(
      gpuEffect.gpuEffectType,
      effectEntry.id,
      paramKey,
    )
    const keyframes = getPropertyKeyframes(itemKeyframes, property)
    if (keyframes.length === 0) {
      return baseValue
    }

    return interpolateColorKeyframesToHex(keyframes, relativeFrame, baseValue)
  }

  if (!isAnimatableGpuNumberParam(gpuEffect, paramKey)) {
    return getNumericGpuEffectParamValue(gpuEffect, paramKey)
  }

  const baseValue = getNumericGpuEffectParamValue(gpuEffect, paramKey)
  if (baseValue === null) {
    return null
  }

  if (!isGpuEffectParamVisible(gpuEffect.gpuEffectType, gpuEffect.params, paramKey)) {
    return baseValue
  }

  const property = buildEffectAnimatableProperty(gpuEffect.gpuEffectType, effectEntry.id, paramKey)
  const keyframes = getPropertyKeyframes(itemKeyframes, property)
  if (keyframes.length === 0) {
    return baseValue
  }

  return interpolatePropertyValue(keyframes, relativeFrame, baseValue)
}

export function resolveAnimatedGpuEffects(
  effects: ItemEffect[] | undefined,
  itemKeyframes: ItemKeyframes | undefined,
  relativeFrame: number,
): ItemEffect[] | undefined {
  const hasAudioPulse = effects?.some((entry) => entry.audioPulse?.enabled) ?? false
  if (!effects || effects.length === 0 || (!itemKeyframes && !hasAudioPulse)) {
    return effects
  }

  let changed = false

  const resolvedEffects = effects.map((effectEntry) => {
    if (effectEntry.effect.type !== 'gpu-effect') {
      return effectEntry
    }

    const gpuEffect = effectEntry.effect
    let nextParams = gpuEffect.params
    let paramsChanged = false

    const paramKeys = new Set([
      ...Object.keys(gpuEffect.params),
      ...getKeyframedEffectParamKeys(effectEntry, itemKeyframes),
    ])

    for (const paramKey of paramKeys) {
      if (!isAnimatableGpuEffectParam(gpuEffect, paramKey)) {
        continue
      }

      if (!isGpuEffectParamVisible(gpuEffect.gpuEffectType, nextParams, paramKey)) {
        continue
      }

      // Procedural audio-pulse wins over keyframes/base for its driven params.
      const pulseOverride = getAudioPulseParamOverride(effectEntry, relativeFrame, paramKey)
      const value =
        pulseOverride !== null
          ? pulseOverride
          : (() => {
              const property = buildEffectAnimatableProperty(
                gpuEffect.gpuEffectType,
                effectEntry.id,
                paramKey,
              )
              const keyframes = getPropertyKeyframes(itemKeyframes, property)
              if (keyframes.length === 0) {
                return null
              }
              return isAnimatableGpuColorParam(gpuEffect, paramKey)
                ? (() => {
                    const baseValue = getColorGpuEffectParamValue(gpuEffect, paramKey)
                    return baseValue === null
                      ? null
                      : interpolateColorKeyframesToHex(keyframes, relativeFrame, baseValue)
                  })()
                : (() => {
                    const baseValue = getNumericGpuEffectParamValue(gpuEffect, paramKey)
                    return baseValue === null
                      ? null
                      : interpolatePropertyValue(keyframes, relativeFrame, baseValue)
                  })()
            })()
      if (value === null) {
        continue
      }

      if (nextParams[paramKey] === value) {
        continue
      }

      if (!paramsChanged) {
        nextParams = { ...gpuEffect.params }
        paramsChanged = true
      }

      nextParams[paramKey] = value
    }

    if (!paramsChanged) {
      return effectEntry
    }

    changed = true
    return {
      ...effectEntry,
      effect: {
        ...gpuEffect,
        params: nextParams,
      },
    }
  })

  return changed ? resolvedEffects : effects
}

export const resolveAnimatedColorEffects = resolveAnimatedGpuEffects
