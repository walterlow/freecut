import type { TFunction } from 'i18next'
import {
  PROPERTY_LABELS,
  isBuiltInAnimatableProperty,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
} from '@/types/keyframe'
import { getGpuEffect } from '@/infrastructure/gpu-effects'

export function getKeyframePropertyLabel(t: TFunction, property: AnimatableProperty): string {
  if (isBuiltInAnimatableProperty(property)) {
    return t(`keyframes.properties.${property}`, { defaultValue: PROPERTY_LABELS[property] })
  }

  const parsed = parseEffectAnimatableProperty(property)
  if (!parsed) {
    return property
  }

  const definition = getGpuEffect(parsed.gpuEffectType)
  const param = definition?.params[parsed.paramKey]
  if (definition && param) {
    const paramLabel = t(`effects.params.${parsed.paramKey}`, { defaultValue: param.label })
    return `${definition.name}: ${paramLabel}`
  }

  return parsed.paramKey
}

export function getKeyframeGroupLabel(t: TFunction, groupId: string, fallback: string): string {
  return t(`keyframes.groups.${groupId}`, { defaultValue: fallback })
}
