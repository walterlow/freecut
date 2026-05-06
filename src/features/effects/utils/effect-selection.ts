import type { ItemEffect } from '@/types/effects'

function areMappedEffectsCompatible(displayEffect: ItemEffect, targetEffect: ItemEffect): boolean {
  if (displayEffect.effect.type !== targetEffect.effect.type) {
    return false
  }

  if (displayEffect.effect.type === 'gpu-effect' && targetEffect.effect.type === 'gpu-effect') {
    return displayEffect.effect.gpuEffectType === targetEffect.effect.gpuEffectType
  }

  return true
}

export function getMappedSelectionEffectEntry(
  displayEffects: ItemEffect[],
  itemEffects: ItemEffect[] | undefined,
  displayEffectId: string,
): ItemEffect | null {
  const effectIndex = displayEffects.findIndex((effect) => effect.id === displayEffectId)
  if (effectIndex < 0) {
    return null
  }

  const displayEffect = displayEffects[effectIndex]
  const targetEffect = itemEffects?.[effectIndex]
  if (!displayEffect || !targetEffect || !areMappedEffectsCompatible(displayEffect, targetEffect)) {
    return null
  }

  return targetEffect
}
