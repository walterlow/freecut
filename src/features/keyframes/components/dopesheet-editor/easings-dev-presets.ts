/**
 * The easing catalog, copied verbatim from easings.dev (names + values). Each
 * "Easing" entry is a cubic-bezier; each "Spring" entry is a physics spring.
 *
 * easings.dev springs are defined as `{ stiffness, damping, mass }`; our runtime
 * spring (`shared/utils/easing.ts::springEasing`) uses the same damped-oscillator
 * physics under the names `{ tension, friction, mass }` (tension = stiffness,
 * friction = damping), so the values map 1:1 with no re-tuning.
 */
import type {
  BezierControlPoints,
  EasingConfig,
  EasingType,
  SpringParameters,
} from '@/types/keyframe'

import { getBezierPresetForEasing } from '../../utils/easing-presets'

export interface EasingPreset {
  /** Verbatim easings.dev display name (also the stable id — names are unique). */
  name: string
  type: 'Easing' | 'Spring'
  bezier?: BezierControlPoints
  /** Already mapped to our runtime units (tension = stiffness, friction = damping). */
  spring?: SpringParameters
}

const bezier = (x1: number, y1: number, x2: number, y2: number): BezierControlPoints => ({
  x1,
  y1,
  x2,
  y2,
})
const spring = (stiffness: number, damping: number, mass: number): SpringParameters => ({
  tension: stiffness,
  friction: damping,
  mass,
})

/** Verbatim from easings.dev, in source order. */
const EASINGS_DEV_PRESETS: readonly EasingPreset[] = [
  { name: 'Anticipate', type: 'Easing', bezier: bezier(1, -0.4, 0.35, 0.95) },
  { name: 'Bouyant', type: 'Spring', spring: spring(900, 80, 10) },
  { name: 'Elegant', type: 'Spring', spring: spring(150, 19, 1.2) },
  { name: 'Bob', type: 'Spring', spring: spring(131.1, 2.3, 0.1) },
  { name: 'Fling', type: 'Spring', spring: spring(800, 80, 4) },
  { name: 'Swift', type: 'Spring', spring: spring(280, 18, 0.3) },
  { name: 'Float', type: 'Spring', spring: spring(290, 15, 2) },
  { name: 'Slow', type: 'Spring', spring: spring(26.7, 4.1, 0.2) },
  { name: 'Snap', type: 'Spring', spring: spring(320, 20, 0.4) },
  { name: 'Stern', type: 'Spring', spring: spring(550, 30, 1.2) },
  { name: 'Boingoingoing', type: 'Spring', spring: spring(1000, 1.5, 0.1) },
  { name: 'Quick Out', type: 'Easing', bezier: bezier(0, 0, 0.2, 1) },
  { name: 'Overshoot Out', type: 'Easing', bezier: bezier(0.175, 0.885, 0.32, 1.275) },
  { name: 'Swift Out', type: 'Easing', bezier: bezier(0.175, 0.885, 0.32, 1.1) },
  { name: 'Snappy Out', type: 'Easing', bezier: bezier(0.19, 1, 0.22, 1) },
  { name: 'In Out', type: 'Easing', bezier: bezier(0.42, 0, 0.58, 1) },
  { name: 'In Quad', type: 'Easing', bezier: bezier(0.55, 0.085, 0.68, 0.53) },
  { name: 'In Cubic', type: 'Easing', bezier: bezier(0.55, 0.055, 0.675, 0.19) },
  { name: 'In Quart', type: 'Easing', bezier: bezier(0.895, 0.03, 0.685, 0.22) },
  { name: 'In Quint', type: 'Easing', bezier: bezier(0.755, 0.05, 0.855, 0.06) },
  { name: 'In Expo', type: 'Easing', bezier: bezier(0.95, 0.05, 0.795, 0.035) },
  { name: 'In Circ', type: 'Easing', bezier: bezier(0.6, 0.04, 0.98, 0.335) },
  { name: 'Out Quad', type: 'Easing', bezier: bezier(0.25, 0.46, 0.45, 0.94) },
  { name: 'Out Cubic', type: 'Easing', bezier: bezier(0.215, 0.61, 0.355, 1) },
  { name: 'Out Quart', type: 'Easing', bezier: bezier(0.165, 0.84, 0.44, 1) },
  { name: 'Out Quint', type: 'Easing', bezier: bezier(0.23, 1, 0.32, 1) },
  { name: 'Out Expo', type: 'Easing', bezier: bezier(0.19, 1, 0.22, 1) },
  { name: 'Out Circ', type: 'Easing', bezier: bezier(0.075, 0.82, 0.165, 1) },
  { name: 'In Out Quad', type: 'Easing', bezier: bezier(0.455, 0.03, 0.515, 0.955) },
  { name: 'In Out Cubic', type: 'Easing', bezier: bezier(0.645, 0.045, 0.355, 1) },
  { name: 'In Out Quart', type: 'Easing', bezier: bezier(0.77, 0, 0.175, 1) },
  { name: 'In Out Quint', type: 'Easing', bezier: bezier(0.86, 0, 0.07, 1) },
  { name: 'In Out Expo', type: 'Easing', bezier: bezier(1, 0, 0, 1) },
  { name: 'In Out Circ', type: 'Easing', bezier: bezier(0.785, 0.135, 0.15, 0.86) },
  { name: 'In Out Base', type: 'Easing', bezier: bezier(0.25, 0.1, 0.25, 1) },
  { name: 'In', type: 'Easing', bezier: bezier(0.42, 0, 1, 1) },
  { name: 'Out', type: 'Easing', bezier: bezier(0, 0, 0.58, 1) },
  { name: 'Linear', type: 'Easing', bezier: bezier(0, 0, 1, 1) },
] as const

export const EASING_PRESETS = EASINGS_DEV_PRESETS.filter((p) => p.type === 'Easing')
export const SPRING_PRESETS = EASINGS_DEV_PRESETS.filter((p) => p.type === 'Spring')

export type EasingDirection = 'in' | 'out' | 'inout' | 'other'

/**
 * Classify an easing preset by direction for the filter bar. `other` covers
 * curves that aren't a plain in/out/in-out (e.g. `Anticipate`, `Linear`) — they
 * only appear under the "All" filter.
 */
export function presetDirection(name: string): EasingDirection {
  const lower = name.toLowerCase()
  if (lower.includes('in out')) return 'inout'
  if (lower === 'in' || lower.startsWith('in ')) return 'in'
  if (lower === 'out' || lower.startsWith('out ') || lower.endsWith(' out')) return 'out'
  return 'other'
}

/** The concrete keyframe easing + config a preset applies. */
export function presetToEasing(preset: EasingPreset): {
  easing: EasingType
  easingConfig: EasingConfig
} {
  if (preset.type === 'Spring' && preset.spring) {
    return { easing: 'spring', easingConfig: { type: 'spring', spring: { ...preset.spring } } }
  }
  return {
    easing: 'cubic-bezier',
    easingConfig: { type: 'cubic-bezier', bezier: { ...(preset.bezier as BezierControlPoints) } },
  }
}

/**
 * The bezier a given easing renders as. Named eases resolve to their fixed
 * curve; anything unshaped (linear / a spring / hold) falls back to the linear
 * diagonal so the curve editor always has something to show.
 */
export function effectiveBezier(
  easing: EasingType,
  config: EasingConfig | undefined,
): BezierControlPoints {
  if (config?.type === 'cubic-bezier' && config.bezier) return { ...config.bezier }
  const preset = getBezierPresetForEasing(easing)
  if (preset) return preset
  return { x1: 0, y1: 0, x2: 1, y2: 1 }
}

const EPS = 1e-4
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS
}

/** Whether a specific catalog preset produces the given easing + config. */
export function presetMatchesEasing(
  preset: EasingPreset,
  easing: EasingType,
  config: EasingConfig | undefined,
): boolean {
  if (easing === 'hold') return false

  if (preset.type === 'Spring') {
    if (config?.type !== 'spring' || !config.spring) return false
    const s = config.spring
    return (
      near(preset.spring!.tension, s.tension) &&
      near(preset.spring!.friction, s.friction) &&
      near(preset.spring!.mass, s.mass)
    )
  }

  if (config?.type === 'spring') return false
  const b = effectiveBezier(easing, config)
  return (
    near(preset.bezier!.x1, b.x1) &&
    near(preset.bezier!.y1, b.y1) &&
    near(preset.bezier!.x2, b.x2) &&
    near(preset.bezier!.y2, b.y2)
  )
}

/**
 * The catalog preset matching the current easing, or null (custom / hold).
 *
 * Some easings.dev presets share identical curves (e.g. `Snappy Out` and
 * `Out Expo` are both `[0.19, 1, 0.22, 1]`), so this returns whichever comes
 * first in source order. Callers that know the user's explicit pick should
 * prefer it via `presetMatchesEasing` to avoid an identical-curve twin stealing
 * the active-preset highlight.
 */
export function findMatchingPreset(
  easing: EasingType,
  config: EasingConfig | undefined,
): EasingPreset | null {
  return EASINGS_DEV_PRESETS.find((preset) => presetMatchesEasing(preset, easing, config)) ?? null
}
