import { getGpuEffect } from '@/infrastructure/gpu/effects';
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation';
import {
  buildEffectAnimatableProperty,
  isEffectAnimatableProperty,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
  type ItemKeyframes,
} from '@/types/keyframe';
import type { GpuEffect, ItemEffect } from '@/types/effects';
import type { TimelineItem } from '@/types/timeline';

function isAnimatableColorNumberParam(
  definition: ReturnType<typeof getGpuEffect>,
  paramKey: string,
): boolean {
  const param = definition?.params[paramKey];
  return Boolean(
    definition &&
      definition.category === 'color' &&
      param?.type === 'number' &&
      param.animatable,
  );
}

function getNumericGpuEffectParamValue(
  effect: GpuEffect,
  paramKey: string,
  definition: ReturnType<typeof getGpuEffect>,
): number | null {
  const param = definition?.params[paramKey];
  const rawValue = effect.params[paramKey];

  if (typeof rawValue === 'number') {
    return rawValue;
  }

  if (param?.type === 'number' && typeof param.default === 'number') {
    return param.default;
  }

  return null;
}

export function getAnimatableEffectPropertiesForItem(item: TimelineItem): AnimatableProperty[] {
  if (!item.effects || item.effects.length === 0) {
    return [];
  }

  const properties: AnimatableProperty[] = [];

  for (const effectEntry of item.effects) {
    if (effectEntry.effect.type !== 'gpu-effect') {
      continue;
    }

    const gpuEffect = effectEntry.effect;
    const definition = getGpuEffect(gpuEffect.gpuEffectType);
    if (!definition || definition.category !== 'color') {
      continue;
    }

    for (const [paramKey, param] of Object.entries(definition.params)) {
      if (param.type !== 'number' || !param.animatable) {
        continue;
      }

      properties.push(
        buildEffectAnimatableProperty(gpuEffect.gpuEffectType, effectEntry.id, paramKey),
      );
    }
  }

  return properties;
}

export function getEffectPropertyBaseValue(
  item: TimelineItem,
  property: AnimatableProperty,
): number | null {
  const parsed = parseEffectAnimatableProperty(property);
  if (!parsed || !item.effects) {
    return null;
  }

  const effectEntry = item.effects.find(
    (entry) =>
      entry.id === parsed.effectId &&
      entry.effect.type === 'gpu-effect' &&
      entry.effect.gpuEffectType === parsed.gpuEffectType,
  );
  if (!effectEntry || effectEntry.effect.type !== 'gpu-effect') {
    return null;
  }

  const definition = getGpuEffect(parsed.gpuEffectType);
  if (!isAnimatableColorNumberParam(definition, parsed.paramKey)) {
    return null;
  }

  return getNumericGpuEffectParamValue(effectEntry.effect, parsed.paramKey, definition);
}

export function getResolvedAnimatedEffectParamValue(
  effectEntry: ItemEffect,
  itemKeyframes: ItemKeyframes | undefined,
  relativeFrame: number,
  paramKey: string,
): number | null {
  if (effectEntry.effect.type !== 'gpu-effect') {
    return null;
  }

  const gpuEffect = effectEntry.effect;
  const definition = getGpuEffect(gpuEffect.gpuEffectType);
  if (!isAnimatableColorNumberParam(definition, paramKey)) {
    return getNumericGpuEffectParamValue(gpuEffect, paramKey, definition);
  }

  const baseValue = getNumericGpuEffectParamValue(gpuEffect, paramKey, definition);
  if (baseValue === null) {
    return null;
  }

  const property = buildEffectAnimatableProperty(gpuEffect.gpuEffectType, effectEntry.id, paramKey);
  const keyframes = getPropertyKeyframes(itemKeyframes, property);
  if (keyframes.length === 0) {
    return baseValue;
  }

  return interpolatePropertyValue(keyframes, relativeFrame, baseValue);
}

export function resolveAnimatedColorEffects(
  effects: ItemEffect[] | undefined,
  itemKeyframes: ItemKeyframes | undefined,
  relativeFrame: number,
): ItemEffect[] | undefined {
  if (!effects || effects.length === 0 || !itemKeyframes) {
    return effects;
  }

  let changed = false;

  const resolvedEffects = effects.map((effectEntry) => {
    if (effectEntry.effect.type !== 'gpu-effect') {
      return effectEntry;
    }

    const gpuEffect = effectEntry.effect;
    const definition = getGpuEffect(gpuEffect.gpuEffectType);
    if (!definition || definition.category !== 'color') {
      return effectEntry;
    }

    let nextParams = gpuEffect.params;
    let paramsChanged = false;

    for (const [paramKey, param] of Object.entries(definition.params)) {
      if (param.type !== 'number' || !param.animatable) {
        continue;
      }

      const baseValue = getNumericGpuEffectParamValue(gpuEffect, paramKey, definition);
      if (baseValue === null) {
        continue;
      }

      const property = buildEffectAnimatableProperty(gpuEffect.gpuEffectType, effectEntry.id, paramKey);
      const keyframes = getPropertyKeyframes(itemKeyframes, property);
      if (keyframes.length === 0) {
        continue;
      }

      const value = interpolatePropertyValue(keyframes, relativeFrame, baseValue);
      if (nextParams[paramKey] === value) {
        continue;
      }

      if (!paramsChanged) {
        nextParams = { ...gpuEffect.params };
        paramsChanged = true;
      }

      nextParams[paramKey] = value;
    }

    if (!paramsChanged) {
      return effectEntry;
    }

    changed = true;
    return {
      ...effectEntry,
      effect: {
        ...gpuEffect,
        params: nextParams,
      },
    };
  });

  return changed ? resolvedEffects : effects;
}

export function isEffectProperty(property: AnimatableProperty): boolean {
  return isEffectAnimatableProperty(property);
}
