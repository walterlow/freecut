/**
 * Analytic evaluation of procedural motion modifiers.
 *
 * Each modifier is a deterministic function of time, so instead of baking a
 * sampled keyframe wall we evaluate the contribution at the current frame and
 * layer it on top of the keyframe-resolved transform. Oscillation rate is in
 * Hz (frame converted to seconds via fps) so motion is frame-rate independent.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { AudioPulseBeat } from '@/types/effects'
import type { AudioReactiveTarget, MotionModifier, MotionModifierType } from '@/types/motion'
import type { MotionGeneratorSettings } from './motion-generator'
import { pulseEnvelope } from './trigger-wave-motion-layer'

const TWO_PI = Math.PI * 2

/** Default oscillation rate (Hz) per modifier type, before duration scaling. */
const BASE_FREQUENCY_HZ: Record<MotionModifierType, number> = {
  'float-drift': 0.625, // ~1.6s per cycle
  'breath-pulse': 0.55, // ~1.8s per breath
  'micro-shake': 8, // noise sample rate (8 updates/sec)
  'audio-reactive': 0, // beat-driven, not a continuous oscillator
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

/**
 * Strongest beat envelope active at the current frame (the "dominant" beat) so
 * overlapping pulses cohere into one hit. Returns 0 when no beat is active.
 */
function dominantBeatPulse(beats: readonly AudioPulseBeat[], frame: number, duration: number): number {
  let best = 0
  for (const beat of beats) {
    const progress = (frame - beat.frame) / duration
    if (progress < 0 || progress >= 1) continue
    const pulse = pulseEnvelope(progress) * (0.5 + 0.5 * beat.amplitude)
    if (pulse > best) best = pulse
  }
  return best
}

function evaluateAudioReactive(
  modifier: MotionModifier,
  ctx: MotionModifierEvalContext,
  out: MotionContribution,
): void {
  const beats = modifier.beats
  if (!beats || beats.length === 0) return
  const duration = Math.max(1, modifier.pulseFrames ?? Math.round(ctx.fps * 0.36))
  const pulse = dominantBeatPulse(beats, ctx.frame, duration)
  if (pulse <= 0) return

  const k = pulse * modifier.amplitude
  switch (modifier.target ?? 'scale') {
    case 'scale': {
      const scale = 1 + 0.28 * k
      out.scaleWidth *= scale
      out.scaleHeight *= scale
      return
    }
    case 'bounce':
      // Kick upward on the beat (negative y = up).
      out.dy -= clamp(ctx.frameHeight * 0.05, 8, 60) * k
      return
    case 'rotation':
      out.dRotation += 7 * k
      return
  }
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
    case 'audio-reactive':
      return evaluateAudioReactive(modifier, ctx, out)
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
 * Build an audio-reactive modifier from pre-detected beats. Beats are already
 * relative to the target item's start; the envelope length scales with the
 * duration setting (shorter = snappier hits).
 */
export function createAudioReactiveModifier(params: {
  beats: AudioPulseBeat[]
  target: AudioReactiveTarget
  settings: MotionGeneratorSettings
  fps: number
  durationInFrames: number
  itemIndex?: number
}): MotionModifier {
  const { beats, target, settings, fps, durationInFrames, itemIndex = 0 } = params
  const maxFrame = Math.max(2, durationInFrames - 1)
  const durationScale = clamp(settings.durationScale, 0.25, 3)
  return {
    id: crypto.randomUUID(),
    type: 'audio-reactive',
    enabled: true,
    amplitude: clamp(settings.intensityScale, 0, 2),
    frequency: 0,
    phaseFrames: 0,
    seed: itemIndex + 1,
    beats,
    pulseFrames: clamp(Math.round(fps * 0.36 * durationScale), 2, maxFrame),
    target,
  }
}
