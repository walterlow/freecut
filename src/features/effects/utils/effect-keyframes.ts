import { getGpuEffect } from '@/infrastructure/gpu-effects'
import { getResolvedAnimatedEffectParamValue } from '@/features/effects/deps/keyframes-contract'
import { buildEffectAnimatableProperty, type AnimatableProperty } from '@/types/keyframe'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'

export function getGpuEffectKeyframeProperty(
  entry: ItemEffect,
  paramKey: string,
): AnimatableProperty | null {
  if (entry.effect.type !== 'gpu-effect') return null
  const definition = getGpuEffect(entry.effect.gpuEffectType)
  const param = definition?.params[paramKey]
  if (!definition || param?.type !== 'number' || !param.animatable) return null
  return buildEffectAnimatableProperty(entry.effect.gpuEffectType, entry.id, paramKey)
}

export function getResolvedGpuEffectForFrame(
  entry: ItemEffect,
  item: TimelineItem | null,
  itemKeyframes: ItemKeyframes | undefined,
  currentFrame: number,
): GpuEffect {
  const gpuEffect = entry.effect as GpuEffect
  const definition = getGpuEffect(gpuEffect.gpuEffectType)
  if (!item || !definition) return gpuEffect

  const relativeFrame = currentFrame - item.from
  let nextParams = gpuEffect.params
  let changed = false

  for (const [paramKey, param] of Object.entries(definition.params)) {
    if (param.type !== 'number' || !param.animatable) continue

    const value = getResolvedAnimatedEffectParamValue(entry, itemKeyframes, relativeFrame, paramKey)
    if (value === null || nextParams[paramKey] === value) continue

    if (!changed) {
      nextParams = { ...gpuEffect.params }
      changed = true
    }
    nextParams[paramKey] = value
  }

  return changed ? { ...gpuEffect, params: nextParams } : gpuEffect
}
