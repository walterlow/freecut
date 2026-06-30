/**
 * Catalog of procedural motion modulators surfaced in the Animate workspace.
 *
 * These are metadata descriptors only — selecting one attaches a parametric
 * {@link MotionModifier} to the clip (see `createMotionModifier`) which is
 * evaluated analytically at render time. They no longer bake keyframes.
 */

import type { TransformAnimatableProperty } from '@/types/keyframe'
import type { MotionModifierType } from '@/types/motion'
import type { MotionThumbnail } from './motion-presets'

export interface MotionModulator {
  /** Matches the {@link MotionModifierType} created when applied. */
  id: MotionModifierType
  labelKey: string
  /** Transform properties the modulator drives — used for selection gating. */
  properties: TransformAnimatableProperty[]
  /** True when it rescales the item box (gated for text clips). */
  scalesBox?: boolean
  /** Animated glyph demonstrating the motion (renders on hover in the panel). */
  thumbnail: MotionThumbnail
}

export const MOTION_MODULATORS: MotionModulator[] = [
  {
    id: 'float-drift',
    labelKey: 'floatDrift',
    properties: ['x', 'y', 'rotation'],
    thumbnail: { kind: 'drift', loop: true },
  },
  {
    id: 'breath-pulse',
    labelKey: 'breathPulse',
    properties: ['width', 'height', 'opacity'],
    scalesBox: true,
    thumbnail: { kind: 'pulse', loop: true },
  },
  {
    id: 'micro-shake',
    labelKey: 'microShake',
    properties: ['x', 'y', 'rotation'],
    thumbnail: { kind: 'micro-shake', loop: true },
  },
]
