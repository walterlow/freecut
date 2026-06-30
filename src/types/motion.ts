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

import type { AudioPulseBeat } from './effects'

export type MotionModifierType = 'float-drift' | 'breath-pulse' | 'micro-shake' | 'audio-reactive'

/** Which transform an audio-reactive modifier pulses on each beat. */
export type AudioReactiveTarget = 'scale' | 'bounce' | 'rotation'

export interface MotionModifier {
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
  // --- audio-reactive only ---
  /**
   * Sparse beats driving an `audio-reactive` modifier, in frames relative to
   * THIS item's start (already remapped from the source audio clip's timeline
   * position at apply time, so render-time evaluation needs no audio decode).
   */
  beats?: AudioPulseBeat[]
  /** Per-beat envelope length in frames (attack + decay) for audio-reactive. */
  pulseFrames?: number
  /** Transform the audio-reactive pulse drives. */
  target?: AudioReactiveTarget
}
