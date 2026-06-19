import { isColorGradeEffectType } from '@/infrastructure/gpu-effects'
import type { ItemEffect, VisualEffect } from '@/types/effects'

type CreateId = () => string

function cloneVisualEffect(effect: VisualEffect): VisualEffect {
  return {
    ...effect,
    params: { ...effect.params },
  }
}

export function isGradePresetEffect(effect: VisualEffect): boolean {
  return effect.type === 'gpu-effect' && isColorGradeEffectType(effect.gpuEffectType)
}

export function hasGradePresetEffects(effects: readonly VisualEffect[]): boolean {
  return effects.some(isGradePresetEffect)
}

export function applyGradePresetToEffectStack(
  currentEffects: readonly ItemEffect[] | undefined,
  presetEffects: readonly VisualEffect[],
  createId: CreateId = () => crypto.randomUUID(),
): ItemEffect[] {
  const preservedEffects = (currentEffects ?? []).filter(
    (entry) => !isGradePresetEffect(entry.effect),
  )
  const gradeEntries = presetEffects.filter(isGradePresetEffect).map((effect) => ({
    id: createId(),
    enabled: true,
    effect: cloneVisualEffect(effect),
  }))

  return [...preservedEffects, ...gradeEntries]
}
