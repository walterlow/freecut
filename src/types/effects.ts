// CSS filter types that work in both browser preview and Remotion export
export type CSSFilterType =
  | 'brightness'
  | 'contrast'
  | 'saturate'
  | 'blur'
  | 'hue-rotate'
  | 'grayscale'
  | 'sepia'
  | 'invert';

// Glitch effect variants (implemented via CSS transforms and layers)
export type GlitchVariant = 'rgb-split' | 'scanlines' | 'color-glitch';

// Canvas-based effect variants (require pixel-level processing)
export type CanvasEffectVariant = 'halftone';

// Overlay effect variants (CSS-based overlays)
export type OverlayEffectVariant = 'vignette';

// CSS filter effect configuration
export interface CSSFilterEffect {
  type: 'css-filter';
  filter: CSSFilterType;
  value: number;
}

// Glitch effect configuration
export interface GlitchEffect {
  type: 'glitch';
  variant: GlitchVariant;
  intensity: number; // 0-1 normalized intensity
  speed: number; // Animation speed multiplier (0.5-2)
  seed: number; // Random seed for deterministic rendering during export
}

// Halftone effect configuration (canvas-based luminance dot pattern)
export interface HalftoneEffect {
  type: 'canvas-effect';
  variant: 'halftone';
  dotSize: number; // Base dot size in pixels (2-20)
  spacing: number; // Dot spacing in pixels (4-40)
  angle: number; // Grid rotation in degrees (0-90)
  intensity: number; // Effect strength 0-1
  backgroundColor: string; // Background color hex
  dotColor: string; // Dot color hex
}

// Vignette effect configuration (CSS radial gradient overlay)
export interface VignetteEffect {
  type: 'overlay-effect';
  variant: 'vignette';
  intensity: number; // Darkness of vignette edges 0-1
  size: number; // How far clear area extends from center 0-1 (0.5 = 50%)
  softness: number; // Edge feathering/softness 0-1
  color: string; // Vignette color (usually black)
  shape: 'circular' | 'elliptical'; // Circular or match aspect ratio
}

// Union of all visual effects
export type VisualEffect = CSSFilterEffect | GlitchEffect | HalftoneEffect | VignetteEffect;

// Effect instance applied to a timeline item
export interface ItemEffect {
  id: string;
  effect: VisualEffect;
  enabled: boolean;
}

// Filter configuration metadata for UI
export interface FilterConfig {
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit: string;
}

// Default configurations for CSS filters
export const CSS_FILTER_CONFIGS: Record<CSSFilterType, FilterConfig> = {
  brightness: { label: 'Brightness', min: 0, max: 200, default: 100, step: 1, unit: '%' },
  contrast: { label: 'Contrast', min: 0, max: 200, default: 100, step: 1, unit: '%' },
  saturate: { label: 'Saturation', min: 0, max: 200, default: 100, step: 1, unit: '%' },
  blur: { label: 'Blur', min: 0, max: 50, default: 0, step: 0.5, unit: 'px' },
  'hue-rotate': { label: 'Hue Rotate', min: 0, max: 360, default: 0, step: 1, unit: '°' },
  grayscale: { label: 'Grayscale', min: 0, max: 100, default: 100, step: 1, unit: '%' },
  sepia: { label: 'Sepia', min: 0, max: 100, default: 100, step: 1, unit: '%' },
  invert: { label: 'Invert', min: 0, max: 100, default: 100, step: 1, unit: '%' },
};

// Glitch effect configuration metadata
export const GLITCH_CONFIGS: Record<GlitchVariant, { label: string; description: string }> = {
  'rgb-split': { label: 'RGB Split', description: 'Chromatic aberration effect' },
  scanlines: { label: 'Scanlines', description: 'CRT monitor scanline overlay' },
  'color-glitch': { label: 'Color Glitch', description: 'Random hue shifts' },
};

// Halftone effect configuration metadata
export const HALFTONE_CONFIG = {
  dotSize: { label: 'Dot Size', min: 2, max: 20, default: 6, step: 1, unit: 'px' },
  spacing: { label: 'Spacing', min: 4, max: 40, default: 8, step: 1, unit: 'px' },
  angle: { label: 'Angle', min: 0, max: 90, default: 45, step: 1, unit: '°' },
  intensity: { label: 'Intensity', min: 0, max: 1, default: 1, step: 0.01, unit: '' },
};

// Canvas effect configuration metadata
export const CANVAS_EFFECT_CONFIGS: Record<CanvasEffectVariant, { label: string; description: string }> = {
  halftone: { label: 'Halftone', description: 'Classic print-style dot pattern based on luminance' },
};

// Vignette effect configuration metadata
export const VIGNETTE_CONFIG = {
  intensity: { label: 'Intensity', min: 0, max: 1, default: 0.5, step: 0.01, unit: '' },
  size: { label: 'Size', min: 0, max: 1, default: 0.5, step: 0.01, unit: '' },
  softness: { label: 'Softness', min: 0, max: 1, default: 0.5, step: 0.01, unit: '' },
};

// Overlay effect configuration metadata
export const OVERLAY_EFFECT_CONFIGS: Record<OverlayEffectVariant, { label: string; description: string }> = {
  vignette: { label: 'Vignette', description: 'Darkened edges for cinematic focus' },
};

// Effect presets (combinations of multiple effects)
export interface EffectPreset {
  id: string;
  name: string;
  effects: VisualEffect[];
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: 'vintage',
    name: 'Vintage',
    effects: [
      { type: 'css-filter', filter: 'sepia', value: 40 },
      { type: 'css-filter', filter: 'contrast', value: 110 },
      { type: 'css-filter', filter: 'brightness', value: 90 },
    ],
  },
  {
    id: 'noir',
    name: 'Noir',
    effects: [
      { type: 'css-filter', filter: 'grayscale', value: 100 },
      { type: 'css-filter', filter: 'contrast', value: 130 },
    ],
  },
  {
    id: 'cold',
    name: 'Cold',
    effects: [
      { type: 'css-filter', filter: 'hue-rotate', value: 180 },
      { type: 'css-filter', filter: 'saturate', value: 80 },
    ],
  },
  {
    id: 'warm',
    name: 'Warm',
    effects: [
      { type: 'css-filter', filter: 'sepia', value: 20 },
      { type: 'css-filter', filter: 'saturate', value: 120 },
    ],
  },
  {
    id: 'dramatic',
    name: 'Dramatic',
    effects: [
      { type: 'css-filter', filter: 'contrast', value: 150 },
      { type: 'css-filter', filter: 'saturate', value: 130 },
    ],
  },
  {
    id: 'faded',
    name: 'Faded',
    effects: [
      { type: 'css-filter', filter: 'contrast', value: 80 },
      { type: 'css-filter', filter: 'brightness', value: 110 },
      { type: 'css-filter', filter: 'saturate', value: 70 },
    ],
  },
];
