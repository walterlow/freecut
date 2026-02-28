/**
 * Canvas Effects Rendering System
 *
 * Applies visual effects to canvas items for client-side export.
 * Supports CSS filters, glitch effects, halftone patterns, and vignette overlays.
 */

import type { ItemEffect, CSSFilterEffect, GlitchEffect, HalftoneEffect, VignetteEffect } from '@/types/effects';
import type { AdjustmentItem } from '@/types/timeline';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('CanvasEffects');

/**
 * Adjustment layer with its track order for scope calculation
 */
export interface AdjustmentLayerWithTrackOrder {
  layer: AdjustmentItem;
  trackOrder: number;
}

/**
 * Canvas settings for effect rendering
 */
interface EffectCanvasSettings {
  width: number;
  height: number;
}

// ============================================================================
// CSS Filter Effects
// ============================================================================

/**
 * Build CSS filter string from effects array.
 * Canvas 2D context supports CSS filter syntax via ctx.filter.
 */
function buildCSSFilterString(effects: ItemEffect[]): string {
  const filterParts: string[] = [];

  for (const effect of effects) {
    if (!effect.enabled) continue;
    if (effect.effect.type !== 'css-filter') continue;

    const cssEffect = effect.effect as CSSFilterEffect;
    const filterStr = cssFilterToString(cssEffect);
    if (filterStr) {
      filterParts.push(filterStr);
    }
  }

  return filterParts.join(' ');
}

/**
 * Convert a CSS filter effect to its CSS filter string.
 */
function cssFilterToString(effect: CSSFilterEffect): string {
  const { filter, value } = effect;

  // Skip default values (no visual effect)
  if (isFilterAtDefault(filter, value)) return '';

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
      log.warn(`Unsupported CSS filter type: ${filter}`);
      return '';
  }
}

/**
 * Check if a CSS filter is at its default (no-op) value.
 */
function isFilterAtDefault(filter: string, value: number): boolean {
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

// ============================================================================
// Glitch Effects
// ============================================================================

/**
 * Seeded random number generator for deterministic glitch patterns.
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Get glitch effects from an effects array.
 */
function getGlitchEffects(effects: ItemEffect[]): GlitchEffect[] {
  return effects
    .filter((e) => e.enabled && e.effect.type === 'glitch')
    .map((e) => e.effect as GlitchEffect);
}

/**
 * Apply RGB split effect to canvas content.
 * Creates chromatic aberration by offsetting color channels.
 *
 * @param ctx - Canvas context
 * @param sourceCanvas - Source content to apply effect to
 * @param intensity - Effect intensity (0-1)
 * @param frame - Current frame number
 * @param speed - Animation speed multiplier
 * @param seed - Random seed for deterministic output
 */
function applyRGBSplit(
  ctx: OffscreenCanvasRenderingContext2D,
  sourceCanvas: OffscreenCanvas,
  intensity: number,
  frame: number,
  speed: number,
  seed: number
): void {
  const random = seededRandom(Math.floor(frame * speed) + seed);
  const baseOffset = intensity * 15;
  const jitter = (random() - 0.5) * intensity * 10;
  const offset = Math.sin(frame * 0.3 * speed) * baseOffset + jitter;

  // If offset is negligible, skip
  if (Math.abs(offset) < 0.5) {
    ctx.drawImage(sourceCanvas, 0, 0);
    return;
  }

  const { width, height } = sourceCanvas;

  // Create temporary canvases for each channel
  const redCanvas = new OffscreenCanvas(width, height);
  const greenCanvas = new OffscreenCanvas(width, height);
  const blueCanvas = new OffscreenCanvas(width, height);

  const redCtx = redCanvas.getContext('2d', { willReadFrequently: true })!;
  const greenCtx = greenCanvas.getContext('2d', { willReadFrequently: true })!;
  const blueCtx = blueCanvas.getContext('2d', { willReadFrequently: true })!;

  // Draw source to each with offset
  // Red channel - shift right
  redCtx.drawImage(sourceCanvas, offset, 0);
  // Green channel - centered
  greenCtx.drawImage(sourceCanvas, 0, 0);
  // Blue channel - shift left
  blueCtx.drawImage(sourceCanvas, -offset, 0);

  // Get image data from each
  const redData = redCtx.getImageData(0, 0, width, height);
  const greenData = greenCtx.getImageData(0, 0, width, height);
  const blueData = blueCtx.getImageData(0, 0, width, height);

  // Combine channels
  const outputData = ctx.createImageData(width, height);
  for (let i = 0; i < outputData.data.length; i += 4) {
    outputData.data[i] = redData.data[i]!;           // Red from red canvas
    outputData.data[i + 1] = greenData.data[i + 1]!; // Green from green canvas
    outputData.data[i + 2] = blueData.data[i + 2]!;  // Blue from blue canvas
    outputData.data[i + 3] = Math.max(              // Alpha is max of all
      redData.data[i + 3]!,
      greenData.data[i + 3]!,
      blueData.data[i + 3]!
    );
  }

  ctx.putImageData(outputData, 0, 0);
}

/**
 * Apply scanlines effect overlay.
 * Creates CRT-style horizontal lines.
 *
 * @param ctx - Canvas context
 * @param canvas - Canvas dimensions
 * @param intensity - Effect intensity (0-1)
 */
function applyScanlines(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: EffectCanvasSettings,
  intensity: number
): void {
  const lineHeight = 2;
  const gapHeight = 2;
  const alpha = intensity * 0.3;

  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;

  for (let y = 0; y < canvas.height; y += lineHeight + gapHeight) {
    ctx.fillRect(0, y + lineHeight, canvas.width, gapHeight);
  }

  ctx.restore();
}

/**
 * Apply color glitch effect.
 * Randomly shifts hue based on seed and frame.
 *
 * @param effects - Array of effects to check for color glitch
 * @param frame - Current frame number
 * @returns Hue rotation in degrees, or 0 if no glitch
 */
function getColorGlitchHueShift(
  effect: GlitchEffect,
  frame: number
): number {
  const random = seededRandom(Math.floor(frame * effect.speed) + effect.seed);

  // Probability of glitch occurring increases with intensity
  const shouldGlitch = random() > 1 - effect.intensity * 0.3;
  if (!shouldGlitch) return 0;

  return random() * 360 * effect.intensity;
}

/**
 * Build combined filter string including glitch effects.
 */
function buildGlitchFilterString(
  effects: GlitchEffect[],
  frame: number
): string {
  const filters: string[] = [];

  for (const effect of effects) {
    if (effect.variant === 'color-glitch') {
      const hueShift = getColorGlitchHueShift(effect, frame);
      if (hueShift !== 0) {
        filters.push(`hue-rotate(${hueShift}deg)`);
      }
    }
    // Note: RGB split and scanlines are handled separately as they need
    // special canvas operations, not CSS filters
  }

  return filters.join(' ');
}

// ============================================================================
// Halftone Effect
// ============================================================================

/**
 * Get halftone effect from effects array.
 */
function getHalftoneEffect(effects: ItemEffect[]): HalftoneEffect | null {
  const effect = effects.find(
    (e) => e.enabled && e.effect.type === 'canvas-effect' && e.effect.variant === 'halftone'
  );
  return effect ? (effect.effect as HalftoneEffect) : null;
}

/**
 * Apply halftone pattern overlay to canvas.
 *
 * @param ctx - Canvas context
 * @param canvas - Canvas dimensions
 * @param effect - Halftone effect configuration
 */
function applyHalftone(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: EffectCanvasSettings,
  effect: HalftoneEffect
): void {
  const {
    patternType = 'dots',
    dotSize,
    spacing,
    angle,
    intensity,
    softness = 0.2,
    blendMode = 'multiply',
    inverted = false,
    dotColor,
  } = effect;

  ctx.save();

  // Calculate pattern
  const patternCanvas = new OffscreenCanvas(spacing, spacing);
  const patternCtx = patternCanvas.getContext('2d')!;

  // Fill background
  patternCtx.fillStyle = inverted ? dotColor : 'transparent';
  patternCtx.fillRect(0, 0, spacing, spacing);

  // Draw pattern element
  const radius = dotSize / 2;
  const hardEdge = radius * (1 - softness * 0.8);

  patternCtx.fillStyle = inverted ? 'transparent' : dotColor;

  switch (patternType) {
    case 'dots': {
      // Create radial gradient for soft dots
      const gradient = patternCtx.createRadialGradient(
        spacing / 2, spacing / 2, 0,
        spacing / 2, spacing / 2, radius
      );
      gradient.addColorStop(0, inverted ? 'transparent' : dotColor);
      gradient.addColorStop(hardEdge / radius, inverted ? 'transparent' : dotColor);
      gradient.addColorStop(1, inverted ? dotColor : 'transparent');
      patternCtx.fillStyle = gradient;
      patternCtx.fillRect(0, 0, spacing, spacing);
      break;
    }
    case 'lines': {
      const lineWidth = dotSize;
      patternCtx.fillRect(0, 0, lineWidth, spacing);
      break;
    }
    case 'rays':
    case 'ripples':
      // These are more complex and would need different approaches
      // For now, fall back to dots pattern
      log.warn(`Halftone pattern '${patternType}' approximated as dots in canvas export`);
      patternCtx.beginPath();
      patternCtx.arc(spacing / 2, spacing / 2, radius, 0, Math.PI * 2);
      patternCtx.fill();
      break;
  }

  // Create pattern
  const pattern = ctx.createPattern(patternCanvas, 'repeat');
  if (!pattern) {
    log.warn('Failed to create halftone pattern');
    ctx.restore();
    return;
  }

  // Apply rotation
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);

  // Set blend mode
  ctx.globalCompositeOperation = mapBlendMode(blendMode);
  ctx.globalAlpha = intensity;
  ctx.fillStyle = pattern;

  // Draw pattern over entire canvas (with extra margin for rotation)
  const margin = Math.max(canvas.width, canvas.height);
  ctx.fillRect(-margin, -margin, canvas.width + margin * 2, canvas.height + margin * 2);

  ctx.restore();
}

/**
 * Map blend mode strings to canvas globalCompositeOperation values.
 */
function mapBlendMode(blendMode: string): GlobalCompositeOperation {
  const mapping: Record<string, GlobalCompositeOperation> = {
    'multiply': 'multiply',
    'screen': 'screen',
    'overlay': 'overlay',
    'soft-light': 'soft-light',
    'hard-light': 'hard-light',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'darken': 'darken',
    'lighten': 'lighten',
    'difference': 'difference',
    'exclusion': 'exclusion',
  };

  const result = mapping[blendMode];
  if (!result) {
    log.warn(`Blend mode '${blendMode}' not supported in canvas - using 'source-over'`);
    return 'source-over';
  }
  return result;
}

// ============================================================================
// Vignette Effect
// ============================================================================

/**
 * Get vignette effect from effects array.
 */
function getVignetteEffect(effects: ItemEffect[]): VignetteEffect | null {
  const effect = effects.find(
    (e) => e.enabled && e.effect.type === 'overlay-effect' && e.effect.variant === 'vignette'
  );
  return effect ? (effect.effect as VignetteEffect) : null;
}

/**
 * Apply vignette overlay to canvas.
 * Creates darkened edges using radial gradient.
 *
 * @param ctx - Canvas context
 * @param canvas - Canvas dimensions
 * @param effect - Vignette effect configuration
 */
function applyVignette(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: EffectCanvasSettings,
  effect: VignetteEffect
): void {
  const { intensity, size, softness, color, shape } = effect;

  // Calculate gradient stops
  const fadeStart = size * 70;
  const fadeRange = 30 + softness * 40;
  const fadeEnd = Math.min(100, fadeStart + fadeRange);

  // Parse color
  const rgba = hexToRgba(color, intensity);

  ctx.save();

  // Create gradient
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // Calculate radius to cover corners
  const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);

  let gradient: CanvasGradient;

  if (shape === 'circular') {
    // Circular gradient
    gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, maxRadius
    );
  } else {
    // Elliptical - stretch to canvas aspect ratio
    // We'll use a circular gradient and scale the context
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(canvas.width / canvas.height, 1);
    ctx.translate(-centerX, -centerY);

    gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, canvas.height / 2
    );
  }

  // Add color stops
  gradient.addColorStop(fadeStart / 100, 'transparent');
  gradient.addColorStop(fadeEnd / 100, rgba);
  gradient.addColorStop(1, rgba);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (shape === 'elliptical') {
    ctx.restore(); // Restore from scale transform
  }

  ctx.restore();
}

/**
 * Convert hex color to rgba string with specified alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============================================================================
// Adjustment Layer Effects
// ============================================================================

/**
 * Get effects from adjustment layers that affect a specific item.
 * An adjustment layer affects an item if:
 * 1. The adjustment layer's track order < item's track order (adjustment is visually ABOVE)
 * 2. The adjustment layer is active at the current frame
 *
 * @param itemTrackOrder - The item's track order
 * @param adjustmentLayers - All adjustment layers with their track orders
 * @param frame - Current frame number
 * @returns Combined effects from all affecting adjustment layers
 */
export function getAdjustmentLayerEffects(
  itemTrackOrder: number,
  adjustmentLayers: AdjustmentLayerWithTrackOrder[],
  frame: number
): ItemEffect[] {
  if (adjustmentLayers.length === 0) return [];

  return adjustmentLayers
    .filter(({ layer, trackOrder }) => {
      // Item must be BEHIND the adjustment (higher track order = lower zIndex)
      if (itemTrackOrder <= trackOrder) return false;
      // Adjustment must be active at current frame
      return frame >= layer.from && frame < layer.from + layer.durationInFrames;
    })
    .sort((a, b) => a.trackOrder - b.trackOrder) // Apply in track order
    .flatMap(({ layer }) => layer.effects?.filter((e) => e.enabled) ?? []);
}

/**
 * Combine item's own effects with adjustment layer effects.
 * Adjustment effects are applied first, then item effects.
 */
export function combineEffects(
  itemEffects: ItemEffect[] | undefined,
  adjustmentEffects: ItemEffect[]
): ItemEffect[] {
  const combined = [...adjustmentEffects];
  if (itemEffects) {
    combined.push(...itemEffects.filter((e) => e.enabled));
  }
  return combined;
}

// ============================================================================
// Main Effect Application
// ============================================================================

/**
 * Apply all effects to a canvas item.
 * This is the main entry point for effect processing.
 *
 * @param ctx - Canvas context where item has been drawn
 * @param sourceCanvas - Offscreen canvas containing the item content
 * @param effects - Combined effects to apply
 * @param frame - Current frame number
 * @param canvas - Canvas dimensions
 */
export function applyAllEffects(
  ctx: OffscreenCanvasRenderingContext2D,
  sourceCanvas: OffscreenCanvas,
  effects: ItemEffect[],
  frame: number,
  canvas: EffectCanvasSettings
): void {
  if (effects.length === 0) {
    // No effects - just draw source
    ctx.drawImage(sourceCanvas, 0, 0);
    return;
  }

  // Collect effect data
  const cssFilterString = buildCSSFilterString(effects);
  const glitchEffects = getGlitchEffects(effects);
  const glitchFilterString = buildGlitchFilterString(glitchEffects, frame);
  const halftoneEffect = getHalftoneEffect(effects);
  const vignetteEffect = getVignetteEffect(effects);

  // Check for RGB split (needs special handling)
  const rgbSplitEffect = glitchEffects.find((e) => e.variant === 'rgb-split');
  const scanlinesEffect = glitchEffects.find((e) => e.variant === 'scanlines');

  // Combine CSS filters
  const combinedFilter = [cssFilterString, glitchFilterString].filter(Boolean).join(' ');

  // Start with source canvas
  let currentCanvas = sourceCanvas;

  // Apply RGB split if present (modifies pixel data)
  if (rgbSplitEffect) {
    const tempCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const tempCtx = tempCanvas.getContext('2d')!;
    applyRGBSplit(
      tempCtx,
      currentCanvas,
      rgbSplitEffect.intensity,
      frame,
      rgbSplitEffect.speed,
      rgbSplitEffect.seed
    );
    currentCanvas = tempCanvas;
  }

  // Apply CSS filters while drawing
  ctx.save();
  if (combinedFilter) {
    ctx.filter = combinedFilter;
  }
  ctx.drawImage(currentCanvas, 0, 0);
  ctx.filter = 'none';
  ctx.restore();

  // Apply overlay effects
  if (scanlinesEffect) {
    applyScanlines(ctx, canvas, scanlinesEffect.intensity);
  }

  if (halftoneEffect) {
    applyHalftone(ctx, canvas, halftoneEffect);
  }

  if (vignetteEffect) {
    applyVignette(ctx, canvas, vignetteEffect);
  }
}

