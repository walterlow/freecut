import type { GlitchEffect } from '@/types/effects';

/**
 * Seeded random number generator for deterministic glitch patterns.
 * Essential for consistent rendering during video export.
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Cache for RGB split filter strings.
 * Key: quantized offset value, Value: encoded SVG filter string.
 * Prevents expensive per-frame SVG re-encoding during playback.
 */
const rgbSplitFilterCache = new Map<number, string>();
const RGB_SPLIT_CACHE_MAX_SIZE = 100;

/**
 * RGB Split effect styles (legacy - returns transform offsets).
 * Creates chromatic aberration by offsetting color channels.
 *
 * @deprecated Use getRGBSplitFilter instead for single-render approach
 * @param intensity - Effect intensity (0-1)
 * @param frame - Current frame number
 * @param speed - Animation speed multiplier
 * @param seed - Random seed for deterministic output
 * @returns Offset values for red and blue channels
 */
export function getRGBSplitStyles(
  intensity: number,
  frame: number,
  speed: number,
  seed: number
): {
  redOffset: number;
  blueOffset: number;
  active: boolean;
} {
  const random = seededRandom(Math.floor(frame * speed) + seed);
  const baseOffset = intensity * 15;
  const jitter = (random() - 0.5) * intensity * 10;

  // Smooth oscillation with random jitter
  const offset = Math.sin(frame * 0.3 * speed) * baseOffset + jitter;

  return {
    redOffset: offset,
    blueOffset: -offset,
    active: Math.abs(offset) > 0.5,
  };
}

/**
 * RGB Split effect using SVG filter (preferred approach).
 * Creates chromatic aberration using a single SVG filter - no content duplication.
 * Works for both clip effects and adjustment layers without audio issues.
 *
 * @param intensity - Effect intensity (0-1)
 * @param frame - Current frame number
 * @param speed - Animation speed multiplier
 * @param seed - Random seed for deterministic output
 * @returns CSS filter string with embedded SVG data URL
 */
export function getRGBSplitFilter(
  intensity: number,
  frame: number,
  speed: number,
  seed: number
): string {
  const random = seededRandom(Math.floor(frame * speed) + seed);
  const baseOffset = intensity * 15;
  const jitter = (random() - 0.5) * intensity * 10;

  // Smooth oscillation with random jitter
  const rawOffset = Math.sin(frame * 0.3 * speed) * baseOffset + jitter;

  // If offset is negligible, return empty string (no filter needed)
  if (Math.abs(rawOffset) < 0.5) {
    return '';
  }

  // Quantize offset to nearest 0.5px to enable caching
  // This reduces unique filter strings from ~30/sec to ~10-15/sec while maintaining smooth animation
  const offset = Math.round(rawOffset * 2) / 2;

  // Check cache first
  const cached = rgbSplitFilterCache.get(offset);
  if (cached) {
    return cached;
  }

  // SVG filter that separates RGB channels and offsets them
  // Red channel goes right (+offset), blue channel goes left (-offset), green stays centered
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <filter id="rgb-split" color-interpolation-filters="sRGB">
        <!-- Extract and offset red channel -->
        <feOffset in="SourceGraphic" dx="${offset}" dy="0" result="redShift"/>
        <feColorMatrix in="redShift" type="matrix"
          values="1 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0" result="red"/>

        <!-- Extract green channel (no offset) -->
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="0 0 0 0 0
                  0 1 0 0 0
                  0 0 0 0 0
                  0 0 0 1 0" result="green"/>

        <!-- Extract and offset blue channel -->
        <feOffset in="SourceGraphic" dx="${-offset}" dy="0" result="blueShift"/>
        <feColorMatrix in="blueShift" type="matrix"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 1 0 0
                  0 0 0 1 0" result="blue"/>

        <!-- Combine channels using screen blend -->
        <feBlend in="red" in2="green" mode="screen" result="rg"/>
        <feBlend in="rg" in2="blue" mode="screen"/>
      </filter>
    </svg>
  `.trim().replace(/\s+/g, ' ');

  // Encode as data URL
  const encoded = encodeURIComponent(svg);
  const filterString = `url("data:image/svg+xml,${encoded}#rgb-split")`;

  // Cache the result (with size limit to prevent memory leak)
  if (rgbSplitFilterCache.size >= RGB_SPLIT_CACHE_MAX_SIZE) {
    // Remove oldest entry (first key)
    const firstKey = rgbSplitFilterCache.keys().next().value;
    if (firstKey !== undefined) {
      rgbSplitFilterCache.delete(firstKey);
    }
  }
  rgbSplitFilterCache.set(offset, filterString);

  return filterString;
}

/**
 * Scanlines effect styles.
 * Creates CRT-style horizontal lines overlay.
 *
 * @param intensity - Effect intensity (0-1)
 * @returns CSS properties for scanline overlay
 */
export function getScanlinesStyle(intensity: number): React.CSSProperties {
  return {
    background: `repeating-linear-gradient(
      0deg,
      transparent 0px,
      transparent 2px,
      rgba(0, 0, 0, ${intensity * 0.3}) 2px,
      rgba(0, 0, 0, ${intensity * 0.3}) 4px
    )`,
    pointerEvents: 'none',
    mixBlendMode: 'multiply',
  };
}

/**
 * Color glitch effect.
 * Returns hue rotation value for random color shifts.
 *
 * @param intensity - Effect intensity (0-1)
 * @param frame - Current frame number
 * @param speed - Animation speed multiplier
 * @param seed - Random seed for deterministic output
 * @returns Hue rotation in degrees (0 if no glitch this frame)
 */
export function getColorGlitch(
  intensity: number,
  frame: number,
  speed: number,
  seed: number
): number {
  const random = seededRandom(Math.floor(frame * speed) + seed);

  // Probability of glitch occurring increases with intensity
  const shouldGlitch = random() > 1 - intensity * 0.3;

  if (!shouldGlitch) return 0;

  return random() * 360 * intensity;
}

/**
 * Get combined glitch CSS filter string including RGB split and color glitch.
 * RGB split is now implemented as an SVG filter (no content duplication).
 *
 * @param glitchEffects - Array of glitch effects to process
 * @param frame - Current frame number
 * @returns CSS filter string for all glitch effects
 */
export function getGlitchFilterString(
  glitchEffects: Array<GlitchEffect & { id: string }>,
  frame: number
): string {
  const filters: string[] = [];

  for (const effect of glitchEffects) {
    if (effect.variant === 'rgb-split') {
      const rgbFilter = getRGBSplitFilter(
        effect.intensity,
        frame,
        effect.speed,
        effect.seed
      );
      if (rgbFilter) {
        filters.push(rgbFilter);
      }
    } else if (effect.variant === 'color-glitch') {
      const hueShift = getColorGlitch(
        effect.intensity,
        frame,
        effect.speed,
        effect.seed
      );
      if (hueShift !== 0) {
        filters.push(`hue-rotate(${hueShift}deg)`);
      }
    }
  }

  return filters.join(' ');
}
