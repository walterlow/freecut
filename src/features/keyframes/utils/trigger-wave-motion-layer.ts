import {
  buildEffectAnimatableProperty,
  type AnimatableProperty,
  type EasingConfig,
  type EasingType,
} from '@/types/keyframe'
import type { AudioPulseModulation, VisualEffect } from '@/types/effects'
import type { MotionGeneratorSettings } from './motion-generator'
import { colorStringToKeyframeValue } from './color-keyframes'

export const TRIGGER_WAVE_MOTION_LAYER_LABEL = 'Trigger Wave Motion'

export interface TriggerWaveMotionLayerKeyframePayload {
  itemId: string
  property: AnimatableProperty
  frame: number
  value: number
  easing?: EasingType
  easingConfig?: EasingConfig
}

export interface AudioReactiveBeat {
  frame: number
  amplitude: number
}

const SNAP_OUT: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.19, y1: 1, x2: 0.22, y2: 1 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getTriggerWaveColor(settings: MotionGeneratorSettings): string {
  return colorStringToKeyframeValue(settings.triggerWaveColor ?? '') === null
    ? '#2e6b8c'
    : settings.triggerWaveColor!
}

function mixPackedRgb(left: number, right: number, amount: number): number {
  const t = clamp(amount, 0, 1)
  const lr = (left >> 16) & 0xff
  const lg = (left >> 8) & 0xff
  const lb = left & 0xff
  const rr = (right >> 16) & 0xff
  const rg = (right >> 8) & 0xff
  const rb = right & 0xff
  return (
    (Math.round(lr + (rr - lr) * t) << 16) +
    (Math.round(lg + (rg - lg) * t) << 8) +
    Math.round(lb + (rb - lb) * t)
  )
}

function getTriggerWaveColorValues(
  settings: MotionGeneratorSettings,
  amount = 1,
): {
  base: number
  accent: number
} {
  const base = colorStringToKeyframeValue(getTriggerWaveColor(settings)) ?? 0x2e6b8c
  return {
    base,
    accent: mixPackedRgb(base, 0xffffff, 0.18 + 0.28 * clamp(amount, 0, 1)),
  }
}

export function createTriggerWaveMotionLayerEffects(
  settings: MotionGeneratorSettings,
): VisualEffect[] {
  const intensity = clamp(settings.intensityScale, 0, 2)
  const glowColor = getTriggerWaveColor(settings)
  return [
    {
      type: 'gpu-effect',
      gpuEffectType: 'gpu-trigger-wave',
      params: {
        strength: 0,
        radius: 1,
        frequency: 24,
        decay: 0.06,
        phase: 0,
        speed: 0,
        centerX: 0.5,
        centerY: 0.5,
        chroma: 0.006 * intensity,
        scanlineMix: 0.22,
        glowColor,
      },
    },
    {
      type: 'gpu-effect',
      gpuEffectType: 'gpu-rgb-split',
      params: { amount: 0.004 * intensity, angle: 0 },
    },
    {
      type: 'gpu-effect',
      gpuEffectType: 'gpu-grain',
      params: { amount: 0.045, size: 1.15, speed: 0.65 },
    },
  ]
}

function effectProperty(effectId: string, paramKey: string): AnimatableProperty {
  return buildEffectAnimatableProperty('gpu-trigger-wave', effectId, paramKey)
}

export function buildTriggerWaveMotionLayerKeyframes(params: {
  itemId: string
  effectId: string
  durationInFrames: number
  fps: number
  settings: MotionGeneratorSettings
}): TriggerWaveMotionLayerKeyframePayload[] {
  const { itemId, effectId, durationInFrames, fps, settings } = params
  const maxFrame = Math.max(0, durationInFrames - 1)
  if (maxFrame <= 0) return []

  const durationFrames = clamp(
    Math.round(fps * 1.2 * clamp(settings.durationScale, 0.25, 3)),
    2,
    maxFrame,
  )
  const attackFrame = clamp(Math.round(durationFrames * 0.12), 1, durationFrames)
  const sustainFrame = clamp(Math.round(durationFrames * 0.35), attackFrame, durationFrames)
  const strength = 0.07 * clamp(settings.intensityScale, 0, 2)
  const chroma = 0.012 * clamp(settings.intensityScale, 0, 2)
  const glowColor = getTriggerWaveColorValues(settings, clamp(settings.intensityScale / 2, 0, 1))

  return [
    {
      itemId,
      property: effectProperty(effectId, 'phase'),
      frame: 0,
      value: 0,
      easing: 'linear',
    },
    {
      itemId,
      property: effectProperty(effectId, 'phase'),
      frame: durationFrames,
      value: 1,
      easing: 'linear',
    },
    {
      itemId,
      property: effectProperty(effectId, 'strength'),
      frame: 0,
      value: 0,
      easing: 'cubic-bezier',
      easingConfig: SNAP_OUT,
    },
    {
      itemId,
      property: effectProperty(effectId, 'strength'),
      frame: attackFrame,
      value: strength,
      easing: 'cubic-bezier',
      easingConfig: SNAP_OUT,
    },
    {
      itemId,
      property: effectProperty(effectId, 'strength'),
      frame: durationFrames,
      value: 0,
      easing: 'linear',
    },
    {
      itemId,
      property: effectProperty(effectId, 'chroma'),
      frame: 0,
      value: chroma,
      easing: 'ease-out',
    },
    {
      itemId,
      property: effectProperty(effectId, 'chroma'),
      frame: sustainFrame,
      value: chroma * 0.55,
      easing: 'ease-in-out',
    },
    {
      itemId,
      property: effectProperty(effectId, 'chroma'),
      frame: durationFrames,
      value: 0,
      easing: 'linear',
    },
    {
      itemId,
      property: effectProperty(effectId, 'glowColor'),
      frame: 0,
      value: glowColor.base,
      easing: 'ease-out',
    },
    {
      itemId,
      property: effectProperty(effectId, 'glowColor'),
      frame: attackFrame,
      value: glowColor.accent,
      easing: 'ease-in-out',
    },
    {
      itemId,
      property: effectProperty(effectId, 'glowColor'),
      frame: durationFrames,
      value: glowColor.base,
      easing: 'linear',
    },
  ]
}

export function detectAudioReactiveBeats(params: {
  waveformData: readonly number[]
  durationInFrames: number
  fps: number
  sensitivity?: number
  maxBeats?: number
}): AudioReactiveBeat[] {
  const { waveformData, durationInFrames, fps } = params
  const maxFrame = Math.max(0, durationInFrames - 1)
  if (waveformData.length === 0 || maxFrame <= 0) return []

  const frameCount = maxFrame + 1
  const frameEnergy = new Array<number>(frameCount).fill(0)
  const samplesPerFrame = waveformData.length / frameCount

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = Math.floor(frame * samplesPerFrame)
    const end = Math.max(start + 1, Math.ceil((frame + 1) * samplesPerFrame))
    let peak = 0
    for (let sample = start; sample < end && sample < waveformData.length; sample += 1) {
      peak = Math.max(peak, Math.abs(waveformData[sample] ?? 0))
    }
    frameEnergy[frame] = peak
  }

  const maxEnergy = Math.max(...frameEnergy)
  if (maxEnergy <= 0) return []

  const normalized = frameEnergy.map((value) => value / maxEnergy)
  const average = normalized.reduce((sum, value) => sum + value, 0) / normalized.length
  const variance =
    normalized.reduce((sum, value) => sum + (value - average) * (value - average), 0) /
    normalized.length
  const deviation = Math.sqrt(variance)
  const sensitivity = clamp(params.sensitivity ?? 1, 0.25, 2)
  const threshold = clamp(Math.max(0.28, average + deviation * (1.1 / sensitivity)), 0.18, 0.9)
  const minSpacing = Math.max(1, Math.round(fps * 0.18))

  const candidates: AudioReactiveBeat[] = []
  for (let frame = 1; frame < normalized.length - 1; frame += 1) {
    const value = normalized[frame] ?? 0
    if (value < threshold) continue
    if (value < (normalized[frame - 1] ?? 0) || value < (normalized[frame + 1] ?? 0)) continue
    candidates.push({ frame, amplitude: value })
  }

  const maxBeats = Math.max(1, params.maxBeats ?? 48)
  const selected: AudioReactiveBeat[] = []
  for (const candidate of [...candidates].sort((left, right) => right.amplitude - left.amplitude)) {
    if (selected.some((beat) => Math.abs(beat.frame - candidate.frame) < minSpacing)) {
      continue
    }
    selected.push(candidate)
    if (selected.length >= maxBeats) break
  }

  return selected.sort((left, right) => left.frame - right.frame)
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Beat-pulse envelope in [0,1]: fast attack to a peak at 15%, ease-out decay. */
export function pulseEnvelope(progress: number): number {
  if (progress < 0.15) return smoothstep(progress / 0.15)
  return 1 - smoothstep((progress - 0.15) / 0.85)
}

/**
 * Build a procedural audio-pulse modulation from detected beats. Replaces the
 * old per-beat keyframe bake (~9 keyframes/beat) with a sparse beat list +
 * envelope params evaluated analytically at render time.
 */
export function createAudioPulseModulation(params: {
  beats: readonly AudioReactiveBeat[]
  durationInFrames: number
  fps: number
  settings: MotionGeneratorSettings
}): AudioPulseModulation {
  const { beats, durationInFrames, fps, settings } = params
  const maxFrame = Math.max(2, durationInFrames - 1)
  const intensity = clamp(settings.intensityScale, 0, 2)
  return {
    enabled: true,
    beats: beats.map((beat) => ({
      frame: clamp(beat.frame, 0, maxFrame),
      amplitude: clamp(beat.amplitude, 0, 1),
    })),
    durationFrames: clamp(
      Math.round(fps * 0.36 * clamp(settings.durationScale, 0.25, 3)),
      2,
      maxFrame,
    ),
    strength: 0.03 + 0.055 * intensity,
    chroma: 0.003 + 0.016 * intensity,
    glowColorBase: getTriggerWaveColorValues(settings, 1).base,
  }
}

export interface AudioPulseFrameValues {
  strength: number
  chroma: number
  phase: number
  /** Packed 0xRRGGBB. */
  glowColor: number
}

/**
 * Evaluate the trigger-wave params driven by audio pulses at a frame. Picks the
 * dominant active beat (the one whose envelope is strongest right now) so
 * overlapping pulses produce one coherent flash.
 */
export function evaluateAudioPulseParams(
  modulation: AudioPulseModulation,
  relativeFrame: number,
): AudioPulseFrameValues | null {
  if (!modulation.enabled || modulation.beats.length === 0) return null

  const duration = Math.max(1, modulation.durationFrames)
  let bestPulse = 0
  let bestProgress = 0
  let bestAmplitude = 0
  let found = false

  for (const beat of modulation.beats) {
    const progress = (relativeFrame - beat.frame) / duration
    if (progress < 0 || progress >= 1) continue
    const pulse = pulseEnvelope(progress) * (0.5 + 0.5 * beat.amplitude)
    if (pulse > bestPulse) {
      bestPulse = pulse
      bestProgress = progress
      bestAmplitude = beat.amplitude
      found = true
    }
  }

  if (!found) {
    return { strength: 0, chroma: 0, phase: 0, glowColor: modulation.glowColorBase }
  }

  const accent = mixPackedRgb(modulation.glowColorBase, 0xffffff, 0.18 + 0.28 * bestAmplitude)
  return {
    strength: modulation.strength * bestPulse,
    chroma: modulation.chroma * (1 - bestProgress) * (0.5 + 0.5 * bestAmplitude),
    phase: bestProgress,
    glowColor: mixPackedRgb(modulation.glowColorBase, accent, smoothstep(bestPulse)),
  }
}
