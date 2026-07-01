import type { TFunction } from 'i18next'
import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'

export function getEffectCategoryLabel(t: TFunction, category: string): string {
  return t(`effects.categories.${category}`, { defaultValue: category })
}

export function getEffectDefinitionName(definition: GpuEffectDefinition): string {
  return definition.name
}

export function getEffectParamLabel(
  t: TFunction,
  definition: GpuEffectDefinition,
  paramKey: string,
): string {
  const fallback = definition.params[paramKey]?.label ?? paramKey
  return t(`effects.params.${paramKey}`, { defaultValue: fallback })
}

export function getEffectOptionLabel(
  t: TFunction,
  _definition: GpuEffectDefinition,
  _paramKey: string,
  option: { value: string; label: string },
): string {
  return t(`effects.options.${option.value}`, { defaultValue: option.label })
}
