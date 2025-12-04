import type { ItemEffect, CSSFilterEffect, CSSFilterType, HalftoneEffect } from '@/types/effects';

/**
 * Convert a CSS filter effect to its CSS filter string representation.
 */
function cssFilterToString(effect: CSSFilterEffect): string {
  const { filter, value } = effect;

  switch (filter) {
    case 'brightness':
      return `brightness(${value}%)`;
    case 'contrast':
      return `contrast(${value}%)`;
    case 'saturate':
      return `saturate(${value}%)`;
    case 'blur':
      return `blur(${value}px)`;
    case 'hue-rotate':
      return `hue-rotate(${value}deg)`;
    case 'grayscale':
      return `grayscale(${value}%)`;
    case 'sepia':
      return `sepia(${value}%)`;
    case 'invert':
      return `invert(${value}%)`;
    default:
      return '';
  }
}

/**
 * Check if a CSS filter is at its default (no-op) value.
 * Returns true if the filter would have no visual effect.
 */
function isFilterAtDefault(filter: CSSFilterType, value: number): boolean {
  switch (filter) {
    case 'brightness':
    case 'contrast':
    case 'saturate':
      return value === 100;
    case 'blur':
    case 'hue-rotate':
    case 'grayscale':
    case 'sepia':
    case 'invert':
      return value === 0;
    default:
      return false;
  }
}

/**
 * Convert an array of effects to a CSS filter string.
 * Only includes enabled effects that are not at their default values.
 *
 * @param effects - Array of item effects to convert
 * @returns CSS filter string (e.g., "brightness(120%) contrast(110%)")
 */
export function effectsToCSSFilter(effects: ItemEffect[]): string {
  return effects
    .filter((e) => e.enabled && e.effect.type === 'css-filter')
    .map((e) => e.effect as CSSFilterEffect)
    .filter((effect) => !isFilterAtDefault(effect.filter, effect.value))
    .map((effect) => cssFilterToString(effect))
    .join(' ');
}

/**
 * Check if any effects require non-CSS rendering (e.g., glitch effects).
 */
export function hasGlitchEffects(effects: ItemEffect[]): boolean {
  return effects.some((e) => e.enabled && e.effect.type === 'glitch');
}

/**
 * Get all enabled glitch effects from an array of effects.
 */
export function getGlitchEffects(effects: ItemEffect[]) {
  return effects
    .filter((e) => e.enabled && e.effect.type === 'glitch')
    .map((e) => ({ id: e.id, ...e.effect }));
}

/**
 * Check if any effects require canvas-based rendering (e.g., halftone).
 */
export function hasCanvasEffects(effects: ItemEffect[]): boolean {
  return effects.some((e) => e.enabled && e.effect.type === 'canvas-effect');
}

/**
 * Get the halftone effect from an array of effects, if present and enabled.
 */
export function getHalftoneEffect(
  effects: ItemEffect[]
): (HalftoneEffect & { id: string }) | null {
  const effect = effects.find(
    (e) => e.enabled && e.effect.type === 'canvas-effect' && e.effect.variant === 'halftone'
  );
  if (!effect) return null;
  return { id: effect.id, ...(effect.effect as HalftoneEffect) };
}
