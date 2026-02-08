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
 * Get all enabled glitch effects from an array of effects.
 */
export function getGlitchEffects(effects: ItemEffect[]) {
  return effects
    .filter((e) => e.enabled && e.effect.type === 'glitch')
    .map((e) => ({ id: e.id, ...e.effect }));
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

/**
 * Generate the background-image pattern based on pattern type.
 */
function getPatternGradient(
  patternType: HalftoneEffect['patternType'],
  dotSize: number,
  softness: number,
  spacing: number,
  fgColor: string,
  bgColor: string
): string {
  // Calculate edge softness: 0 = sharp edge, 1 = very fuzzy
  // Sharp: solid color up to edge, then instant transition
  // Fuzzy: gradient from center to edge
  const radius = dotSize / 2;
  const hardEdge = radius * (1 - softness * 0.8); // How much is solid

  switch (patternType) {
    case 'dots':
      return `radial-gradient(circle at center, ${fgColor} ${hardEdge}px, ${bgColor} ${radius}px)`;

    case 'lines': {
      // Repeating linear gradient for parallel lines
      // Line width is dotSize, gap is (spacing - dotSize)
      const lineWidth = dotSize;
      const lineHardEdge = lineWidth * (1 - softness * 0.5);
      return `repeating-linear-gradient(0deg, ${fgColor} 0px, ${fgColor} ${lineHardEdge}px, ${bgColor} ${lineWidth}px, ${bgColor} ${spacing}px)`;
    }

    case 'rays': {
      // Repeating conic gradient for sunburst/ray pattern
      // Each ray takes up a portion of the 360 degrees
      const rayAngle = (dotSize / spacing) * 30; // Scale dot size to angle
      const rayHardEdge = rayAngle * (1 - softness * 0.5);
      return `repeating-conic-gradient(from 0deg, ${fgColor} 0deg, ${fgColor} ${rayHardEdge}deg, ${bgColor} ${rayAngle}deg)`;
    }

    case 'ripples': {
      // Repeating radial gradient for concentric circles
      const rippleWidth = dotSize;
      const rippleHardEdge = rippleWidth * (1 - softness * 0.5);
      return `repeating-radial-gradient(circle at center, ${fgColor} 0px, ${fgColor} ${rippleHardEdge}px, ${bgColor} ${rippleWidth}px, ${bgColor} ${spacing}px)`;
    }

    default:
      return `radial-gradient(circle at center, ${fgColor} ${hardEdge}px, ${bgColor} ${radius}px)`;
  }
}

/**
 * Convert fade angle (0-360) to CSS gradient direction.
 * 0° = right, 90° = down, 180° = left, 270° = up
 * The gradient goes FROM visible TO invisible in the specified direction.
 */
function getFadeGradientAngle(angleInDegrees: number): string {
  // CSS linear-gradient angle: 0deg = to top, 90deg = to right
  // We want: 0° = fade toward right, 90° = fade toward down
  // So we need to add 90° to convert from our convention to CSS convention
  const cssAngle = (angleInDegrees + 90) % 360;
  return `${cssAngle}deg`;
}

/**
 * Generate CSS styles for halftone effect.
 * Uses pure CSS technique: pattern gradients + mix-blend-mode + contrast filter.
 *
 * Supports multiple pattern types: dots, lines, rays, ripples.
 * Supports gradient fade using CSS mask-image on a wrapper (fade doesn't rotate with pattern).
 *
 * Returns styles for:
 * - containerStyle: outer container with contrast filter
 * - fadeWrapperStyle: wrapper with CSS mask for fade (doesn't rotate)
 * - patternStyle: the pattern overlay (rotates with angle)
 */
export function getHalftoneStyles(effect: HalftoneEffect): {
  containerStyle: React.CSSProperties;
  fadeWrapperStyle?: React.CSSProperties;
  patternStyle: React.CSSProperties;
} {
  const {
    patternType = 'dots',
    dotSize,
    spacing,
    angle,
    intensity,
    softness = 0.2,
    blendMode = 'multiply',
    inverted = false,
    fadeAngle = -1,
    fadeAmount = 0.5,
    dotColor,
  } = effect;

  // Dot color is the pattern color, background is always transparent
  // This ensures content on lower tracks shows through
  const fgColor = inverted ? 'transparent' : dotColor;
  const bgColor = inverted ? dotColor : 'transparent';

  // With transparent background, we don't use the contrast filter trick
  // (that only works with solid backgrounds to create binary halftone)
  // Instead, intensity now controls the dot opacity for a cleaner overlay effect
  const dotOpacity = intensity;

  // Generate pattern based on type
  const patternGradient = getPatternGradient(patternType, dotSize, softness, spacing, fgColor, bgColor);

  // For rays and ripples, we don't need to tile - they fill the space
  // For dots and lines, we need background-size for tiling
  const needsTiling = patternType === 'dots' || patternType === 'lines';

  const result: {
    containerStyle: React.CSSProperties;
    fadeWrapperStyle?: React.CSSProperties;
    patternStyle: React.CSSProperties;
  } = {
    containerStyle: {
      position: 'relative' as const,
      // No contrast filter with transparent background - it doesn't work properly
      // No backgroundColor - always transparent so lower content shows through
    },
    patternStyle: {
      position: 'absolute' as const,
      // Extend beyond container to handle rotation without gaps
      top: '-50%',
      left: '-50%',
      width: '200%',
      height: '200%',
      backgroundImage: patternGradient,
      ...(needsTiling && {
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundRepeat: 'repeat',
      }),
      transform: `rotate(${angle}deg)`,
      mixBlendMode: blendMode,
      opacity: dotOpacity, // Intensity now controls pattern opacity
      pointerEvents: 'none' as const,
    },
  };

  // Add fade wrapper with CSS mask if fade is enabled
  // The mask is on the wrapper so it doesn't rotate with the pattern
  // fadeAngle: -1 = disabled, 0-360 = direction in degrees
  if (fadeAngle >= 0 && fadeAmount > 0) {
    const gradientDir = getFadeGradientAngle(fadeAngle);
    // Fade is dominant - only a small portion at the origin is fully solid
    // fadeAmount controls how far across the fade extends (min 5% when enabled)
    const clampedFadeAmount = Math.max(0.05, fadeAmount); // Minimum 5% fade when enabled
    const solidPercent = 5; // Only 5% at origin is fully visible
    const fadeEnd = Math.round(30 + clampedFadeAmount * 70); // Fade ends at 30-100% based on amount

    // CSS mask: black = visible, transparent = hidden
    // Small solid zone, then gradual fade across most of the area
    const maskGradient = `linear-gradient(${gradientDir}, black 0%, black ${solidPercent}%, transparent ${fadeEnd}%)`;

    result.fadeWrapperStyle = {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      // Use mask to fade out the pattern
      maskImage: maskGradient,
      WebkitMaskImage: maskGradient,
      pointerEvents: 'none' as const,
    };
  }

  return result;
}
