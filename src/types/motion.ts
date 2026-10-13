/**
 * Procedural motion modifiers.
 *
 * Continuous, time-driven motion (drift, breathing, shake) is described by a
 * small parametric record and evaluated analytically at render time, rather
 * than baked into thousands of sampled keyframes. This keeps projects small,
 * the dopesheet clean, and the parameters live-editable.
 *
 * The evaluator lives in `@/features/keyframes/utils/motion-modifier-eval`.
 */

import type { EasingConfig, EasingType, TransformAnimatableProperty } from './keyframe'

export type MotionModifierType = 'float-drift' | 'breath-pulse' | 'micro-shake' | 'sway' | 'spin'

/** Transform channels a procedural modifier may target. */
export type MotionModifierChannel = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity'

/**
 * Per-channel gain. A missing map is the v1 compatibility form and means 100%
 * on every channel supported by the modifier type; zero mutes one channel.
 */
export type MotionModifierChannelGains = Partial<Record<MotionModifierChannel, number>>

export interface MotionModifier {
  /** v2 adds independently typed channel gains; omitted values are legacy v1. */
  version?: 2
  /** Stable id (for list keys / per-instance edits). */
  id: string
  type: MotionModifierType
  /** When false the modifier is retained but contributes nothing. */
  enabled: boolean
  /**
   * Intensity multiplier (0–2). Scales the per-type amplitude that is derived
   * from the canvas dimensions at evaluation time.
   */
  amplitude: number
  /**
   * Oscillation rate in Hz (cycles per second). Frame-rate independent — the
   * evaluator converts the current frame to seconds via the project fps, so the
   * same modifier looks identical at 24, 30 or 60 fps.
   */
  frequency: number
  /**
   * Per-item phase offset in frames. Used to stagger a modifier applied to a
   * multi-clip selection so the clips don't move in lockstep.
   */
  phaseFrames: number
  /** Deterministic noise seed (micro-shake). Varies per item in a selection. */
  seed: number
  /** Independently tune or mute the modifier's supported transform channels. */
  channelGains?: MotionModifierChannelGains
}

/** How an authored motion-layer track composes with the keyframed pose. */
export type MotionLayerBlendMode = 'add' | 'multiply'

/**
 * A keyframe inside a non-destructive motion layer. Values are contributions,
 * not absolute transform values: additive tracks use deltas and multiplicative
 * Scale tracks use factors where 1 is the identity.
 */
export interface MotionLayerKeyframe {
  id: string
  frame: number
  value: number
  easing: EasingType
  easingConfig?: EasingConfig
}

export interface MotionLayerTrack {
  property: TransformAnimatableProperty
  blend: MotionLayerBlendMode
  keyframes: MotionLayerKeyframe[]
}

/**
 * Named, independently removable animation applied after base keyframes and
 * before continuous procedural modifiers. This is the true additive-layer
 * counterpart to merging generated diamonds into the base lanes.
 */
export interface MotionAnimationLayer {
  id: string
  name: string
  enabled: boolean
  source: 'built-in-preset' | 'saved-preset'
  sourcePresetId: string
  tracks: MotionLayerTrack[]
}
