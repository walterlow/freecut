// GPU shader effect configuration
export interface GpuEffect {
  type: 'gpu-effect'
  gpuEffectType: string // ID from GPU_EFFECT_REGISTRY (e.g. 'gpu-brightness')
  params: Record<string, number | boolean | string>
}

// Union of all visual effects (GPU-only since v6 migration)
export type VisualEffect = GpuEffect

/** A detected audio onset, frame relative to the item start. */
export interface AudioPulseBeat {
  frame: number
  amplitude: number // 0..1 normalized onset strength
}

/**
 * Procedural audio-reactive modulation of a `gpu-trigger-wave` effect.
 * Stores the sparse detected beats + envelope shape and is evaluated
 * analytically per frame at render time (no baked keyframes).
 */
export interface AudioPulseModulation {
  enabled: boolean
  beats: AudioPulseBeat[]
  /** Envelope length per beat, in frames. */
  durationFrames: number
  /** Peak strength at a full-amplitude beat. */
  strength: number
  /** Peak chroma at a full-amplitude beat. */
  chroma: number
  /** Resting glow color as packed 0xRRGGBB. */
  glowColorBase: number
}

// Effect instance applied to a timeline item
export interface ItemEffect {
  id: string
  effect: VisualEffect
  enabled: boolean
  /** Procedural audio-reactive driver for this effect's params (trigger-wave). */
  audioPulse?: AudioPulseModulation
}

// Effect presets (combinations of multiple effects)
interface EffectPreset {
  id: string
  name: string
  effects: VisualEffect[]
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: 'trigger-wave-layer',
    name: 'Trigger Wave Layer',
    effects: [
      {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-trigger-wave',
        params: {
          strength: 0.045,
          radius: 0.95,
          frequency: 22,
          decay: 0.07,
          phase: 0,
          speed: 0.9,
          centerX: 0.5,
          centerY: 0.5,
          chroma: 0.009,
          scanlineMix: 0.24,
          glowColor: '#2e6b8c',
        },
      },
      {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-rgb-split',
        params: { amount: 0.006, angle: 0 },
      },
      {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-scanlines',
        params: { density: 8, opacity: 0.16, speed: 0.6 },
      },
      {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-grain',
        params: { amount: 0.05, size: 1.2, speed: 0.8 },
      },
    ],
  },
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
]
