// GPU shader effect configuration
export interface GpuEffect {
  type: 'gpu-effect';
  gpuEffectType: string; // ID from GPU_EFFECT_REGISTRY (e.g. 'gpu-brightness')
  params: Record<string, number | boolean | string>;
}

// Union of all visual effects (GPU-only since v6 migration)
export type VisualEffect = GpuEffect;

// Effect instance applied to a timeline item
export interface ItemEffect {
  id: string;
  effect: VisualEffect;
  enabled: boolean;
}

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
      { type: 'gpu-effect', gpuEffectType: 'gpu-sepia', params: { amount: 0.4 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-contrast', params: { amount: 1.1 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { amount: -0.1 } },
    ],
  },
  {
    id: 'noir',
    name: 'Noir',
    effects: [
      { type: 'gpu-effect', gpuEffectType: 'gpu-grayscale', params: { amount: 1 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-contrast', params: { amount: 1.3 } },
    ],
  },
  {
    id: 'cold',
    name: 'Cold',
    effects: [
      { type: 'gpu-effect', gpuEffectType: 'gpu-hue-shift', params: { shift: 0.5 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-saturation', params: { amount: 0.8 } },
    ],
  },
  {
    id: 'warm',
    name: 'Warm',
    effects: [
      { type: 'gpu-effect', gpuEffectType: 'gpu-sepia', params: { amount: 0.2 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-saturation', params: { amount: 1.2 } },
    ],
  },
  {
    id: 'dramatic',
    name: 'Dramatic',
    effects: [
      { type: 'gpu-effect', gpuEffectType: 'gpu-contrast', params: { amount: 1.5 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-saturation', params: { amount: 1.3 } },
    ],
  },
  {
    id: 'faded',
    name: 'Faded',
    effects: [
      { type: 'gpu-effect', gpuEffectType: 'gpu-contrast', params: { amount: 0.8 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { amount: 0.1 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-saturation', params: { amount: 0.7 } },
    ],
  },
];
