// CSS filter types that work in both browser preview and Composition export
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
type CanvasEffectVariant = 'halftone';

// Halftone pattern types
export type HalftonePatternType = 'dots' | 'lines' | 'rays' | 'ripples';

// Halftone blend modes
export type HalftoneBlendMode = 'multiply' | 'screen' | 'overlay' | 'soft-light';

// Overlay effect variants (CSS-based overlays)
type OverlayEffectVariant = 'vignette';

// Color grading variants
export type ColorGradingVariant = 'lut' | 'curves' | 'wheels';

// Built-in LUT presets (v1)
export type LUTPresetId =
  | 'cinematic'
  | 'teal-orange'
  | 'warm-film'
  | 'cool-film'
  | 'fade-vintage'
  | 'kodak-2383-d55'
  | 'kodak-2383-d60'
  | 'kodak-2383-d65'
  | 'fuji-3513-d55'
  | 'fuji-3513-d60'
  | 'fuji-3513-d65'
  | 'bleach-bypass'
  | 'm31'
  | 'day-for-night'
  | 'matrix-green';

export interface CurvePoint {
  x: number; // Normalized input 0..1
  y: number; // Normalized output 0..1
}

export interface CurvesChannels {
  master: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

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

// Halftone effect configuration (CSS-based pattern effect)
export interface HalftoneEffect {
  type: 'canvas-effect';
  variant: 'halftone';
  patternType: HalftonePatternType; // Pattern style: dots, lines, rays, ripples
  dotSize: number; // Base dot/line size in pixels (2-20)
  spacing: number; // Pattern spacing in pixels (4-40)
  angle: number; // Dot/pattern grid rotation in degrees (0-360)
  intensity: number; // Effect strength 0-1 (controls opacity)
  softness: number; // Edge softness 0-1 (0 = sharp, 1 = fuzzy)
  blendMode: HalftoneBlendMode; // How pattern blends with content
  inverted: boolean; // Swap foreground/background
  fadeAngle: number; // Fade direction in degrees (0-360, 0=right, 90=down, 180=left, 270=up), -1=disabled
  fadeAmount: number; // Fade strength 0-1 (0 = no fade, 1 = full fade)
  dotColor: string; // Dot/pattern color hex (background is always transparent)
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

// LUT effect configuration (v1 built-in LUT presets)
export interface LUTEffect {
  type: 'color-grading';
  variant: 'lut';
  preset: LUTPresetId;
  intensity: number; // 0-1 blend amount
  cubeName?: string; // Optional imported .cube file name
  cubeData?: string; // Optional .cube file contents (when set, overrides preset approximation)
}

// Parametric curves effect (v1 slider-based tone curve controls)
export interface CurvesEffect {
  type: 'color-grading';
  variant: 'curves';
  // Interactive curve points (v1)
  channels?: CurvesChannels;
  // Master tonal controls (all channels)
  shadows: number; // -100..100
  midtones: number; // -100..100
  highlights: number; // -100..100
  contrast: number; // -100..100
  // Per-channel bias controls
  red: number; // -100..100
  green: number; // -100..100
  blue: number; // -100..100
}

// Color wheels effect (v1 3-way tonal controls)
export interface WheelsEffect {
  type: 'color-grading';
  variant: 'wheels';
  // Hue in degrees, amount in normalized 0-1
  shadowsHue: number; // 0..360
  shadowsAmount: number; // 0..1
  midtonesHue: number; // 0..360
  midtonesAmount: number; // 0..1
  highlightsHue: number; // 0..360
  highlightsAmount: number; // 0..1
  // Global balancing controls
  temperature: number; // -100..100
  tint: number; // -100..100
  saturation: number; // -100..100
}

// Union of all visual effects
export type VisualEffect =
  | CSSFilterEffect
  | GlitchEffect
  | HalftoneEffect
  | VignetteEffect
  | LUTEffect
  | CurvesEffect
  | WheelsEffect;

// Effect instance applied to a timeline item
export interface ItemEffect {
  id: string;
  effect: VisualEffect;
  enabled: boolean;
}

// Filter configuration metadata for UI
interface FilterConfig {
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

// Halftone pattern type labels
export const HALFTONE_PATTERN_LABELS: Record<HalftonePatternType, string> = {
  dots: 'Dots',
  lines: 'Lines',
  rays: 'Rays',
  ripples: 'Ripples',
};

// Halftone blend mode labels
export const HALFTONE_BLEND_MODE_LABELS: Record<HalftoneBlendMode, string> = {
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  'soft-light': 'Soft Light',
};

// Halftone effect configuration metadata
export const HALFTONE_CONFIG = {
  patternType: { label: 'Pattern', default: 'dots' as HalftonePatternType },
  dotSize: { label: 'Size', min: 2, max: 20, default: 6, step: 1, unit: 'px' },
  spacing: { label: 'Spacing', min: 4, max: 40, default: 8, step: 1, unit: 'px' },
  angle: { label: 'Angle', min: 0, max: 360, default: 45, step: 1, unit: '°' },
  intensity: { label: 'Intensity', min: 0, max: 1, default: 1, step: 0.01, unit: '' },
  softness: { label: 'Softness', min: 0, max: 1, default: 0.2, step: 0.01, unit: '' },
  blendMode: { label: 'Blend', default: 'multiply' as HalftoneBlendMode },
  inverted: { label: 'Inverted', default: false },
  fadeAngle: { label: 'Fade', min: -1, max: 360, default: -1, step: 1, unit: '°' }, // -1 = disabled
  fadeAmount: { label: 'Fade Amount', min: 0.05, max: 1, default: 0.5, step: 0.01, unit: '' },
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

// LUT preset metadata and target adjustments.
// These values are interpreted by color-grading utilities to build CSS/canvas filter approximations.
export const LUT_PRESET_CONFIGS: Record<
  LUTPresetId,
  {
    label: string;
    description: string;
    target: {
      brightness?: number;
      contrast?: number;
      saturate?: number;
      sepia?: number;
      hueRotate?: number;
      grayscale?: number;
    };
  }
> = {
  cinematic: {
    label: 'Cinematic',
    description: 'Slightly crushed blacks and richer contrast',
    target: { brightness: 94, contrast: 116, saturate: 108, sepia: 4, hueRotate: 2 },
  },
  'teal-orange': {
    label: 'Teal & Orange',
    description: 'Cool shadows and warm skin-tone contrast',
    target: { brightness: 97, contrast: 112, saturate: 122, sepia: 8, hueRotate: 14 },
  },
  'warm-film': {
    label: 'Warm Film',
    description: 'Golden, nostalgic film stock feel',
    target: { brightness: 98, contrast: 108, saturate: 112, sepia: 16, hueRotate: -6 },
  },
  'cool-film': {
    label: 'Cool Film',
    description: 'Subtle cool cast with crisp tonality',
    target: { brightness: 99, contrast: 110, saturate: 102, sepia: 2, hueRotate: 12 },
  },
  'fade-vintage': {
    label: 'Fade Vintage',
    description: 'Lifted blacks and desaturated retro mood',
    target: { brightness: 106, contrast: 88, saturate: 78, sepia: 18, hueRotate: -4, grayscale: 6 },
  },
  'kodak-2383-d55': {
    label: 'Kodak 2383 D55',
    description: 'Warm print-film emulation with richer contrast',
    target: { brightness: 96, contrast: 118, saturate: 108, sepia: 9, hueRotate: -4 },
  },
  'kodak-2383-d60': {
    label: 'Kodak 2383 D60',
    description: 'Neutral Kodak print-style balance',
    target: { brightness: 97, contrast: 116, saturate: 106, sepia: 6, hueRotate: -1 },
  },
  'kodak-2383-d65': {
    label: 'Kodak 2383 D65',
    description: 'Cooler Kodak print point with clean highlights',
    target: { brightness: 98, contrast: 114, saturate: 104, sepia: 3, hueRotate: 4 },
  },
  'fuji-3513-d55': {
    label: 'Fuji 3513 D55',
    description: 'Warm Fuji print-style look with gentle rolloff',
    target: { brightness: 99, contrast: 110, saturate: 104, sepia: 7, hueRotate: -3 },
  },
  'fuji-3513-d60': {
    label: 'Fuji 3513 D60',
    description: 'Neutral Fuji print-style response',
    target: { brightness: 100, contrast: 108, saturate: 102, sepia: 3, hueRotate: 2 },
  },
  'fuji-3513-d65': {
    label: 'Fuji 3513 D65',
    description: 'Cool Fuji print-style balance',
    target: { brightness: 101, contrast: 106, saturate: 100, sepia: 1, hueRotate: 6 },
  },
  'bleach-bypass': {
    label: 'Bleach Bypass',
    description: 'High-contrast, desaturated chemical-process look',
    target: { brightness: 95, contrast: 132, saturate: 62, sepia: 6, grayscale: 12 },
  },
  m31: {
    label: 'M31 Blockbuster',
    description: 'Popular blockbuster teal-orange treatment',
    target: { brightness: 96, contrast: 120, saturate: 118, sepia: 10, hueRotate: 16 },
  },
  'day-for-night': {
    label: 'Day for Night',
    description: 'Moonlit cool conversion with reduced luminance',
    target: { brightness: 72, contrast: 112, saturate: 78, hueRotate: 30, grayscale: 5 },
  },
  'matrix-green': {
    label: 'Matrix Green',
    description: 'Green-biased cyberpunk monochrome tint',
    target: { brightness: 94, contrast: 118, saturate: 90, sepia: 8, hueRotate: -18 },
  },
};

// Curves control metadata
export const CURVES_CONFIG = {
  shadows: { label: 'Shadows', min: -100, max: 100, default: 0, step: 1, unit: '' },
  midtones: { label: 'Midtones', min: -100, max: 100, default: 0, step: 1, unit: '' },
  highlights: { label: 'Highlights', min: -100, max: 100, default: 0, step: 1, unit: '' },
  contrast: { label: 'Contrast', min: -100, max: 100, default: 0, step: 1, unit: '' },
  red: { label: 'Red', min: -100, max: 100, default: 0, step: 1, unit: '' },
  green: { label: 'Green', min: -100, max: 100, default: 0, step: 1, unit: '' },
  blue: { label: 'Blue', min: -100, max: 100, default: 0, step: 1, unit: '' },
} as const;

// Color wheels control metadata
export const WHEELS_CONFIG = {
  shadowsHue: { label: 'Shadows Hue', min: 0, max: 360, default: 220, step: 1, unit: 'deg' },
  shadowsAmount: { label: 'Shadows Amt', min: 0, max: 1, default: 0, step: 0.01, unit: '' },
  midtonesHue: { label: 'Midtones Hue', min: 0, max: 360, default: 40, step: 1, unit: 'deg' },
  midtonesAmount: { label: 'Midtones Amt', min: 0, max: 1, default: 0, step: 0.01, unit: '' },
  highlightsHue: { label: 'Highlights Hue', min: 0, max: 360, default: 45, step: 1, unit: 'deg' },
  highlightsAmount: { label: 'Highlights Amt', min: 0, max: 1, default: 0, step: 0.01, unit: '' },
  temperature: { label: 'Temperature', min: -100, max: 100, default: 0, step: 1, unit: '' },
  tint: { label: 'Tint', min: -100, max: 100, default: 0, step: 1, unit: '' },
  saturation: { label: 'Saturation', min: -100, max: 100, default: 0, step: 1, unit: '' },
} as const;

// Effect presets (combinations of multiple effects)
interface EffectPreset {
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
