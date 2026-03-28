/** Blend modes for layer compositing (GPU compositor) */
export type BlendMode =
  // Normal
  | 'normal'
  | 'dissolve'
  // Darken
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  // Lighten
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  // Contrast
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  // Inversion
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  // Component (HSL)
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** Map blend mode string to u32 index for GPU shader */
export const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  'normal': 0,
  'dissolve': 1,
  'darken': 2,
  'multiply': 3,
  'color-burn': 4,
  'linear-burn': 5,
  'lighten': 6,
  'screen': 7,
  'color-dodge': 8,
  'linear-dodge': 9,
  'overlay': 10,
  'soft-light': 11,
  'hard-light': 12,
  'vivid-light': 13,
  'linear-light': 14,
  'pin-light': 15,
  'hard-mix': 16,
  'difference': 17,
  'exclusion': 18,
  'subtract': 19,
  'divide': 20,
  'hue': 21,
  'saturation': 22,
  'color': 23,
  'luminosity': 24,
};

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  'normal': 'Normal',
  'dissolve': 'Dissolve',
  'darken': 'Darken',
  'multiply': 'Multiply',
  'color-burn': 'Color Burn',
  'linear-burn': 'Linear Burn',
  'lighten': 'Lighten',
  'screen': 'Screen',
  'color-dodge': 'Color Dodge',
  'linear-dodge': 'Linear Dodge (Add)',
  'overlay': 'Overlay',
  'soft-light': 'Soft Light',
  'hard-light': 'Hard Light',
  'vivid-light': 'Vivid Light',
  'linear-light': 'Linear Light',
  'pin-light': 'Pin Light',
  'hard-mix': 'Hard Mix',
  'difference': 'Difference',
  'exclusion': 'Exclusion',
  'subtract': 'Subtract',
  'divide': 'Divide',
  'hue': 'Hue',
  'saturation': 'Saturation',
  'color': 'Color',
  'luminosity': 'Luminosity',
};

/** Grouped blend modes for UI dropdown */
export const BLEND_MODE_GROUPS: { label: string; modes: BlendMode[] }[] = [
  { label: 'Normal', modes: ['normal', 'dissolve'] },
  { label: 'Darken', modes: ['darken', 'multiply', 'color-burn', 'linear-burn'] },
  { label: 'Lighten', modes: ['lighten', 'screen', 'color-dodge', 'linear-dodge'] },
  { label: 'Contrast', modes: ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix'] },
  { label: 'Inversion', modes: ['difference', 'exclusion', 'subtract', 'divide'] },
  { label: 'Component', modes: ['hue', 'saturation', 'color', 'luminosity'] },
];
