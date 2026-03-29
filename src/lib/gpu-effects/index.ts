import type { GpuEffectDefinition, GpuEffectCategory } from './types';
export type { GpuEffectDefinition, GpuEffectCategory, GpuEffectInstance, EffectParam } from './types';
export { EffectsPipeline } from './effects-pipeline';

import * as colorEffects from './effects/color';
import * as blurEffects from './effects/blur';
import * as distortEffects from './effects/distort';
import * as stylizeEffects from './effects/stylize';
import * as keyingEffects from './effects/keying';

export const GPU_EFFECT_REGISTRY = new Map<string, GpuEffectDefinition>();

export const GPU_EFFECT_CATEGORIES: Record<GpuEffectCategory, GpuEffectDefinition[]> = {
  color: [],
  blur: [],
  distort: [],
  stylize: [],
  keying: [],
};

function isEffectDefinition(obj: unknown): obj is GpuEffectDefinition {
  return (
    typeof obj === 'object' && obj !== null &&
    'id' in obj && 'name' in obj && 'category' in obj &&
    'shader' in obj && 'entryPoint' in obj && 'packUniforms' in obj
  );
}

function registerEffects(effects: Record<string, unknown>) {
  Object.values(effects).forEach(effect => {
    if (isEffectDefinition(effect)) {
      GPU_EFFECT_REGISTRY.set(effect.id, effect);
      GPU_EFFECT_CATEGORIES[effect.category]?.push(effect);
    }
  });
}

registerEffects(colorEffects);
registerEffects(blurEffects);
registerEffects(distortEffects);
registerEffects(stylizeEffects);
registerEffects(keyingEffects);

export function getGpuEffect(id: string): GpuEffectDefinition | undefined {
  return GPU_EFFECT_REGISTRY.get(id);
}

export function getGpuEffectDefaultParams(id: string): Record<string, number | boolean | string> {
  const effect = GPU_EFFECT_REGISTRY.get(id);
  if (!effect) return {};
  const defaults: Record<string, number | boolean | string> = {};
  for (const [key, param] of Object.entries(effect.params)) {
    defaults[key] = param.default;
  }
  return defaults;
}

export function getGpuEffectsByCategory(category: GpuEffectCategory): GpuEffectDefinition[] {
  return GPU_EFFECT_CATEGORIES[category] ?? [];
}

export function getGpuCategoriesWithEffects(): { category: GpuEffectCategory; effects: GpuEffectDefinition[] }[] {
  return Object.entries(GPU_EFFECT_CATEGORIES)
    .filter(([, effects]) => effects.length > 0)
    .map(([category, effects]) => ({
      category: category as GpuEffectCategory,
      effects,
    }));
}
