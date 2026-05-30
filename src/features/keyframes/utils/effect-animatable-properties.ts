import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'
import {
  buildEffectAnimatableProperty,
  isEffectAnimatableProperty,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
  type ItemKeyframes,
} from '@/types/keyframe'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'

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

function getNumericGpuEffectParamValue(effect: GpuEffect, paramKey: string): number | null {
  const rawValue = effect.params[paramKey]

  if (typeof rawValue === 'number') {
    return rawValue
  }

  return null
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
      if (typeof value !== 'number' || !isAnimatableGpuNumberParam(gpuEffect, paramKey)) {
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

  if (!isAnimatableGpuNumberParam(effectEntry.effect, parsed.paramKey)) {
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

  return getNumericGpuEffectParamValue(effectEntry.effect, parsed.paramKey)
}

export function getResolvedAnimatedEffectParamValue(
  effectEntry: ItemEffect,
  itemKeyframes: ItemKeyframes | undefined,
  relativeFrame: number,
  paramKey: string,
): number | null {
  if (effectEntry.effect.type !== 'gpu-effect') {
    return null
  }

  const gpuEffect = effectEntry.effect
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
  if (!effects || effects.length === 0 || !itemKeyframes) {
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
      if (!isAnimatableGpuNumberParam(gpuEffect, paramKey)) {
        continue
      }

      if (!isGpuEffectParamVisible(gpuEffect.gpuEffectType, nextParams, paramKey)) {
        continue
      }

      const baseValue = getNumericGpuEffectParamValue(gpuEffect, paramKey)
      if (baseValue === null) {
        continue
      }

      const property = buildEffectAnimatableProperty(
        gpuEffect.gpuEffectType,
        effectEntry.id,
        paramKey,
      )
      const keyframes = getPropertyKeyframes(itemKeyframes, property)
      if (keyframes.length === 0) {
        continue
      }

      const value = interpolatePropertyValue(keyframes, relativeFrame, baseValue)
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

export function isEffectProperty(property: AnimatableProperty): boolean {
  return isEffectAnimatableProperty(property)
}
