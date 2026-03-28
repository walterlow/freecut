/**
 * Mapping from BlendMode to CSS mix-blend-mode and Canvas2D globalCompositeOperation.
 *
 * Not all 25 Photoshop blend modes have direct CSS/Canvas equivalents.
 * Unsupported modes fall back to the closest available option.
 */
import type { BlendMode } from './blend-modes';

/** Map blend mode to CSS mix-blend-mode value */
export const BLEND_MODE_CSS: Record<BlendMode, React.CSSProperties['mixBlendMode']> = {
  'normal': 'normal',
  'dissolve': 'normal', // no CSS equivalent
  'darken': 'darken',
  'multiply': 'multiply',
  'color-burn': 'color-burn',
  'linear-burn': 'color-burn', // no CSS equivalent, closest
  'lighten': 'lighten',
  'screen': 'screen',
  'color-dodge': 'color-dodge',
  'linear-dodge': 'color-dodge', // no CSS equivalent, closest
  'overlay': 'overlay',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  'vivid-light': 'hard-light', // no CSS equivalent, closest
  'linear-light': 'hard-light', // no CSS equivalent, closest
  'pin-light': 'hard-light', // no CSS equivalent, closest
  'hard-mix': 'hard-light', // no CSS equivalent, closest
  'difference': 'difference',
  'exclusion': 'exclusion',
  'subtract': 'exclusion', // no CSS equivalent, closest
  'divide': 'normal', // no CSS equivalent
  'hue': 'hue',
  'saturation': 'saturation',
  'color': 'color',
  'luminosity': 'luminosity',
};

/** Map blend mode to Canvas2D globalCompositeOperation value */
export const BLEND_MODE_COMPOSITE_OP: Record<BlendMode, GlobalCompositeOperation> = {
  'normal': 'source-over',
  'dissolve': 'source-over',
  'darken': 'darken',
  'multiply': 'multiply',
  'color-burn': 'color-over' as GlobalCompositeOperation, // fallback below
  'linear-burn': 'source-over',
  'lighten': 'lighten',
  'screen': 'screen',
  'color-dodge': 'source-over',
  'linear-dodge': 'lighter', // additive blend
  'overlay': 'overlay',
  'soft-light': 'source-over',
  'hard-light': 'hard-light',
  'vivid-light': 'source-over',
  'linear-light': 'source-over',
  'pin-light': 'source-over',
  'hard-mix': 'source-over',
  'difference': 'difference',
  'exclusion': 'exclusion',
  'subtract': 'source-over',
  'divide': 'source-over',
  'hue': 'hue',
  'saturation': 'saturation',
  'color': 'color',
  'luminosity': 'luminosity',
};

/**
 * Get the Canvas2D composite operation for a blend mode.
 * Falls back to 'source-over' for unsupported modes.
 */
export function getCompositeOperation(mode: BlendMode): GlobalCompositeOperation {
  const op = BLEND_MODE_COMPOSITE_OP[mode];
  // Some composite operations aren't supported in all browsers — validate
  if (op === 'color-over' as GlobalCompositeOperation) return 'source-over';
  return op;
}
