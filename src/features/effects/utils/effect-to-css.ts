import type React from 'react';
import type { ItemEffect, CSSFilterEffect, CSSFilterType, HalftoneEffect, VignetteEffect } from '@/types/effects';

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

/**
 * Check if any effects require overlay rendering (e.g., vignette).
 */
export function hasOverlayEffects(effects: ItemEffect[]): boolean {
  return effects.some((e) => e.enabled && e.effect.type === 'overlay-effect');
}

/**
 * Get the vignette effect from an array of effects, if present and enabled.
 */
export function getVignetteEffect(
  effects: ItemEffect[]
): (VignetteEffect & { id: string }) | null {
  const effect = effects.find(
    (e) => e.enabled && e.effect.type === 'overlay-effect' && e.effect.variant === 'vignette'
  );
  if (!effect) return null;
  return { id: effect.id, ...(effect.effect as VignetteEffect) };
}

/**
 * Generate CSS style for vignette effect overlay.
 * Uses radial gradient to create darkened edges.
 */
export function getVignetteStyle(effect: VignetteEffect): React.CSSProperties {
  const { intensity, size, softness, color, shape } = effect;

  // Calculate gradient stops based on size and softness
  // size: how far the clear center extends (0 = edges dark, 1 = mostly clear)
  // softness: how gradual the transition is (0 = hard edge, 1 = very gradual)
  //
  // For a natural vignette look:
  // - fadeStart: where we start fading from transparent
  // - fadeEnd: where we reach full vignette color
  const fadeStart = size * 70; // Clear area extends up to 70% at max size
  const fadeRange = 30 + softness * 40; // Soft gradient range (30-70%)
  const fadeEnd = Math.min(100, fadeStart + fadeRange);

  // Parse color and apply intensity as alpha
  const rgba = hexToRgba(color, intensity);

  // Shape determines gradient shape - farthest-corner ensures coverage
  const gradientShape = shape === 'circular' ? 'circle farthest-corner' : 'ellipse farthest-corner';

  return {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    background: `radial-gradient(${gradientShape} at center, transparent ${fadeStart}%, ${rgba} ${fadeEnd}%)`,
  };
}

/**
 * Convert hex color to rgba string with specified alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  // Remove # if present
  const cleanHex = hex.replace('#', '');

  // Parse hex values
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
