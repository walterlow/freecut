/**
 * Analytic evaluation of procedural motion modifiers.
 *
 * Each modifier is a deterministic function of time, so instead of baking a
 * sampled keyframe wall we evaluate the contribution at the current frame and
 * layer it on top of the keyframe-resolved transform. Oscillation rate is in
 * Hz (frame converted to seconds via fps) so motion is frame-rate independent.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { MotionModifier, MotionModifierType } from '@/types/motion'
import type { MotionGeneratorSettings } from './motion-generator'

const TWO_PI = Math.PI * 2

/** Default oscillation rate (Hz) per modifier type, before duration scaling. */
const BASE_FREQUENCY_HZ: Record<MotionModifierType, number> = {
  'float-drift': 0.625, // ~1.6s per cycle
  'breath-pulse': 0.55, // ~1.8s per breath
  'micro-shake': 8, // noise sample rate (8 updates/sec)
  sway: 0.5, // ~2s per sway (one cycle per 2s, matching the old loop preset)
  spin: 0.3, // revolutions per second (~3.3s per turn)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Signed value noise in [-1, 1] from an integer-ish seed. */
function hashNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Smoothly interpolated value noise sampled at `s` (continuous time index). */
function valueNoise(seed: number, s: number): number {
  const i = Math.floor(s)
  const frac = s - i
  const a = hashNoise(seed + i)
  const b = hashNoise(seed + i + 1)
  return a + (b - a) * smoothstep(frac)
}

export interface MotionModifierEvalContext {
  /** Frame relative to the item start. */
  frame: number
  fps: number
  frameWidth: number
  frameHeight: number
}

/**
 * Combined contribution of all active modifiers at a frame. Position/rotation/
 * opacity are additive deltas; width/height are multiplicative scales.
 */
export interface MotionContribution {
  dx: number
  dy: number
  dRotation: number
  dOpacity: number
  scaleWidth: number
  scaleHeight: number
}

const ZERO_CONTRIBUTION: MotionContribution = {
  dx: 0,
  dy: 0,
  dRotation: 0,
  dOpacity: 0,
  scaleWidth: 1,
  scaleHeight: 1,
}

function evaluateFloatDrift(
  modifier: MotionModifier,
  ctx: MotionModifierEvalContext,
  out: MotionContribution,
): void {
  const t = ctx.frame / Math.max(1, ctx.fps)
  const phase = (modifier.phaseFrames / Math.max(1, ctx.fps)) * modifier.frequency * TWO_PI
  const xAmp = clamp(ctx.frameWidth * 0.008, 4, 18) * modifier.amplitude
  const yAmp = clamp(ctx.frameHeight * 0.014, 6, 28) * modifier.amplitude
  const rotAmp = 1.2 * modifier.amplitude

  out.dx += xAmp * Math.sin(TWO_PI * modifier.frequency * t + phase + Math.PI / 2)
  out.dy += yAmp * Math.sin(TWO_PI * modifier.frequency * t + phase)
  // Rotation drifts at half speed for a looser feel.
  out.dRotation += rotAmp * Math.sin(Math.PI * modifier.frequency * t + phase + Math.PI)
}

function evaluateBreathPulse(
  modifier: MotionModifier,
  ctx: MotionModifierEvalContext,
  out: MotionContribution,
): void {
  const t = ctx.frame / Math.max(1, ctx.fps)
  const phase = (modifier.phaseFrames / Math.max(1, ctx.fps)) * modifier.frequency * TWO_PI
  const scaleAmount = 0.035 * modifier.amplitude
  const opacityAmount = Math.min(0.08, 0.04 * modifier.amplitude)
  const wave = Math.sin(TWO_PI * modifier.frequency * t + phase)

  out.scaleWidth *= 1 + scaleAmount * wave
  out.scaleHeight *= 1 + scaleAmount * wave
  out.dOpacity += opacityAmount * wave
}

function evaluateMicroShake(
  modifier: MotionModifier,
  ctx: MotionModifierEvalContext,
  out: MotionContribution,
): void {
  const t = ctx.frame / Math.max(1, ctx.fps)
  const s = t * modifier.frequency
  const xAmp = clamp(ctx.frameWidth * 0.004, 2, 10) * modifier.amplitude
  const yAmp = clamp(ctx.frameHeight * 0.004, 2, 10) * modifier.amplitude
  const rotAmp = 0.55 * modifier.amplitude
  const seed = modifier.seed * 97

  out.dx += valueNoise(seed + 11, s) * xAmp
  out.dy += valueNoise(seed + 23, s) * yAmp
  out.dRotation += valueNoise(seed + 37, s) * rotAmp
}

/** Gentle rotation oscillation around the anchor (±4° at full intensity). */
function evaluateSway(
  modifier: MotionModifier,
  ctx: MotionModifierEvalContext,
  out: MotionContribution,
): void {
  const t = ctx.frame / Math.max(1, ctx.fps)
  const phase = (modifier.phaseFrames / Math.max(1, ctx.fps)) * modifier.frequency * TWO_PI
  out.dRotation += 4 * modifier.amplitude * Math.sin(TWO_PI * modifier.frequency * t + phase)
}

/**
 * Continuous rotation (not an oscillator): a constant angular velocity that
 * accumulates over the clip. `frequency` is revolutions/sec and amplitude scales
 * the speed (so Intensity 0 stops it, higher spins faster).
 */
function evaluateSpin(
  modifier: MotionModifier,
  ctx: MotionModifierEvalContext,
  out: MotionContribution,
): void {
  const t = ctx.frame / Math.max(1, ctx.fps)
  out.dRotation += 360 * modifier.frequency * modifier.amplitude * t
}

function evaluateOne(
  modifier: MotionModifier,
  ctx: MotionModifierEvalContext,
  out: MotionContribution,
): void {
  if (!modifier.enabled || modifier.amplitude <= 0) return
  switch (modifier.type) {
    case 'float-drift':
      return evaluateFloatDrift(modifier, ctx, out)
    case 'breath-pulse':
      return evaluateBreathPulse(modifier, ctx, out)
    case 'micro-shake':
      return evaluateMicroShake(modifier, ctx, out)
    case 'sway':
      return evaluateSway(modifier, ctx, out)
    case 'spin':
      return evaluateSpin(modifier, ctx, out)
    default: {
      // Compile-time exhaustiveness: adding a MotionModifierType without a
      // handler here becomes a type error instead of a silent no-op.
      const _exhaustive: never = modifier.type
      return _exhaustive
    }
  }
}

export function evaluateMotionModifiers(
  modifiers: readonly MotionModifier[] | undefined,
  ctx: MotionModifierEvalContext,
): MotionContribution {
  if (!modifiers || modifiers.length === 0) return ZERO_CONTRIBUTION
  const out: MotionContribution = { ...ZERO_CONTRIBUTION }
  for (const modifier of modifiers) {
    evaluateOne(modifier, ctx, out)
  }
  return out
}

/**
 * Layer all active modifiers onto an already-resolved transform. Returns the
 * input unchanged when there is nothing to apply (cheap fast path for the
 * common no-modifier case in the render loop).
 */
export function applyMotionModifiers(
  resolved: ResolvedTransform,
  modifiers: readonly MotionModifier[] | undefined,
  ctx: MotionModifierEvalContext,
): ResolvedTransform {
  if (!modifiers || modifiers.length === 0) return resolved
  const c = evaluateMotionModifiers(modifiers, ctx)
  if (
    c.dx === 0 &&
    c.dy === 0 &&
    c.dRotation === 0 &&
    c.dOpacity === 0 &&
    c.scaleWidth === 1 &&
    c.scaleHeight === 1
  ) {
    return resolved
  }

  return {
    ...resolved,
    x: resolved.x + c.dx,
    y: resolved.y + c.dy,
    rotation: resolved.rotation + c.dRotation,
    width: Math.max(1, resolved.width * c.scaleWidth),
    height: Math.max(1, resolved.height * c.scaleHeight),
    opacity: clamp(resolved.opacity + c.dOpacity, 0, 1),
  }
}

/**
 * Build a modifier instance from the generator settings. `itemIndex` staggers
 * phase and varies the noise seed across a multi-clip selection.
 */
export function createMotionModifier(
  type: MotionModifierType,
  settings: MotionGeneratorSettings,
  itemIndex = 0,
): MotionModifier {
  const durationScale = clamp(settings.durationScale, 0.25, 3)
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    amplitude: clamp(settings.intensityScale, 0, 2),
    // Larger duration scale => slower oscillation.
    frequency: BASE_FREQUENCY_HZ[type] / durationScale,
    phaseFrames: Math.max(0, settings.staggerFrames) * Math.max(0, itemIndex),
    seed: itemIndex + 1,
  }
}

/**
 * Read the editable generator settings back out of a live modifier, so a flyout
 * can seed its sliders from the modifier already on the clip. `frequency` is the
 * inverse of `durationScale` (slower = lower Hz), so we recover the scale here.
 */
export function getMotionModifierSettings(modifier: MotionModifier): {
  intensityScale: number
  durationScale: number
} {
  const base = BASE_FREQUENCY_HZ[modifier.type]
  const durationScale =
    base > 0 && modifier.frequency > 0 ? clamp(base / modifier.frequency, 0.25, 3) : 1
  return { intensityScale: clamp(modifier.amplitude, 0, 2), durationScale }
}

/**
 * Return a copy of `modifier` with edited intensity/duration applied, preserving
 * its identity (id, seed, phase) so editing tunes the existing instance rather
 * than replacing it. Mirrors {@link createMotionModifier}'s amplitude/frequency
 * math so a baked result matches what the flyout previews.
 */
export function updateMotionModifierSettings(
  modifier: MotionModifier,
  settings: { intensityScale?: number; durationScale?: number },
): MotionModifier {
  const next: MotionModifier = { ...modifier }
  if (settings.intensityScale !== undefined) {
    next.amplitude = clamp(settings.intensityScale, 0, 2)
  }
  if (settings.durationScale !== undefined) {
    next.frequency = BASE_FREQUENCY_HZ[modifier.type] / clamp(settings.durationScale, 0.25, 3)
  }
  return next
}
