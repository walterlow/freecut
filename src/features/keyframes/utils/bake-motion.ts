/**
 * Bake procedural motion (transform modifiers + audio-pulse) into editable
 * keyframes — the bridge for hand-tweaking one instance of a procedural result
 * (cf. After Effects' "Convert Expression to Keyframes").
 *
 * Sampling is adaptive: smooth oscillators get ~6 samples/cycle, noise (shake)
 * is sampled at its noise rate, and audio pulses emit a few control points per
 * beat. Pure functions — the caller supplies the resolved base transform.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { AudioPulseModulation } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import type { AudioReactiveTarget, MotionModifier, MotionModifierType } from '@/types/motion'
import {
  buildEffectAnimatableProperty,
  type AnimatableProperty,
  type EasingType,
  type ItemKeyframes,
  type TransformAnimatableProperty,
} from '@/types/keyframe'
import { resolveAnimatedTransform } from './animated-transform-resolver'
import { applyMotionModifiers } from './motion-modifier-eval'
import { evaluateAudioPulseParams } from './trigger-wave-motion-layer'

export interface BakedKeyframe {
  property: AnimatableProperty
  frame: number
  value: number
  easing: EasingType
}

const MODIFIER_PROPERTIES: Record<
  Exclude<MotionModifierType, 'audio-reactive'>,
  TransformAnimatableProperty[]
> = {
  'float-drift': ['x', 'y', 'rotation'],
  'breath-pulse': ['width', 'height', 'opacity'],
  'micro-shake': ['x', 'y', 'rotation'],
}

/** Transform properties an audio-reactive modifier writes, by target. */
function audioReactiveProperties(target: AudioReactiveTarget): TransformAnimatableProperty[] {
  switch (target) {
    case 'scale':
      return ['width', 'height']
    case 'bounce':
      return ['y']
    case 'rotation':
      return ['rotation']
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Finest uniform sample step (frames) across the continuous-wave modifiers; 0
 * when none. Audio-reactive modifiers are beat-driven, not oscillators — they
 * contribute explicit control frames instead (see {@link beatControlFrames}).
 */
function sampleStep(modifiers: readonly MotionModifier[], fps: number): number {
  let step = Number.POSITIVE_INFINITY
  for (const modifier of modifiers) {
    if (!modifier.enabled || modifier.amplitude <= 0) continue
    if (modifier.type === 'audio-reactive') continue
    // Smooth waves: 6 samples/cycle. Noise: sample at the noise rate itself.
    const samplesPerCycle = modifier.type === 'micro-shake' ? 1 : 6
    const stepForModifier = Math.max(
      1,
      Math.round(fps / Math.max(0.01, modifier.frequency * samplesPerCycle)),
    )
    step = Math.min(step, stepForModifier)
  }
  return Number.isFinite(step) ? step : 0
}

/** Control frames around each audio-reactive beat: rest, onset, peak, decay end. */
function beatControlFrames(
  modifiers: readonly MotionModifier[],
  fps: number,
  last: number,
): number[] {
  const frames: number[] = []
  for (const modifier of modifiers) {
    if (modifier.type !== 'audio-reactive' || !modifier.enabled || modifier.amplitude <= 0) continue
    if (!modifier.beats || modifier.beats.length === 0) continue
    const duration = Math.max(1, modifier.pulseFrames ?? Math.round(fps * 0.36))
    const attack = Math.round(duration * 0.15)
    for (const beat of modifier.beats) {
      const start = clamp(beat.frame, 0, last)
      frames.push(Math.max(0, start - 1), start, clamp(start + attack, 0, last), clamp(start + duration, 0, last))
    }
  }
  return frames
}

function activeProperties(modifiers: readonly MotionModifier[]): TransformAnimatableProperty[] {
  const set = new Set<TransformAnimatableProperty>()
  for (const modifier of modifiers) {
    if (!modifier.enabled || modifier.amplitude <= 0) continue
    const properties =
      modifier.type === 'audio-reactive'
        ? audioReactiveProperties(modifier.target ?? 'scale')
        : MODIFIER_PROPERTIES[modifier.type]
    for (const property of properties) set.add(property)
  }
  return [...set]
}

export function bakeMotionModifiersToKeyframes(params: {
  baseTransform: ResolvedTransform
  keyframes: ItemKeyframes | undefined
  modifiers: readonly MotionModifier[]
  durationInFrames: number
  fps: number
  frameWidth: number
  frameHeight: number
}): { keyframes: BakedKeyframe[]; properties: TransformAnimatableProperty[] } {
  const { baseTransform, keyframes, modifiers, durationInFrames, fps, frameWidth, frameHeight } =
    params

  const properties = activeProperties(modifiers)
  const last = Math.max(0, durationInFrames - 1)
  if (properties.length === 0 || last <= 0) {
    return { keyframes: [], properties: [] }
  }

  // Union of uniform wave samples and per-beat control frames, so both
  // continuous and audio-reactive modifiers are captured in one pass.
  const frameSet = new Set<number>([0, last])
  const step = sampleStep(modifiers, fps)
  if (step > 0) {
    for (let frame = 0; frame <= last; frame += step) frameSet.add(frame)
  }
  for (const frame of beatControlFrames(modifiers, fps, last)) frameSet.add(frame)
  const frames = [...frameSet].sort((left, right) => left - right)

  const baked: BakedKeyframe[] = []
  for (const frame of frames) {
    const animated = resolveAnimatedTransform(baseTransform, keyframes, frame)
    const resolved = applyMotionModifiers(animated, modifiers, {
      frame,
      fps,
      frameWidth,
      frameHeight,
    })
    for (const property of properties) {
      baked.push({ property, frame, value: resolved[property], easing: 'linear' })
    }
  }

  return { keyframes: baked, properties }
}

export function bakeAudioPulseToKeyframes(params: {
  effectId: string
  modulation: AudioPulseModulation
  durationInFrames: number
}): BakedKeyframe[] {
  const { effectId, modulation, durationInFrames } = params
  const last = Math.max(0, durationInFrames - 1)
  if (!modulation.enabled || modulation.beats.length === 0 || last <= 0) return []

  const duration = Math.max(1, modulation.durationFrames)
  const attack = Math.round(duration * 0.15)

  // A few control points per beat: rest-before, onset, attack peak, decay end.
  const controlFrames = new Set<number>([0, last])
  for (const beat of modulation.beats) {
    const start = clamp(beat.frame, 0, last)
    controlFrames.add(Math.max(0, start - 1))
    controlFrames.add(start)
    controlFrames.add(clamp(start + attack, 0, last))
    controlFrames.add(clamp(start + duration, 0, last))
  }

  const baked: BakedKeyframe[] = []
  for (const frame of [...controlFrames].sort((left, right) => left - right)) {
    const values = evaluateAudioPulseParams(modulation, frame)
    if (!values) continue
    baked.push(
      { property: prop(effectId, 'strength'), frame, value: values.strength, easing: 'linear' },
      { property: prop(effectId, 'chroma'), frame, value: values.chroma, easing: 'linear' },
      { property: prop(effectId, 'phase'), frame, value: values.phase, easing: 'linear' },
      { property: prop(effectId, 'glowColor'), frame, value: values.glowColor, easing: 'linear' },
    )
  }
  return baked
}

function prop(effectId: string, paramKey: string): AnimatableProperty {
  return buildEffectAnimatableProperty('gpu-trigger-wave', effectId, paramKey)
}

/** A single item's bake instructions: keyframes to add + procedural to drop. */
export interface BakeMotionPlanEntry {
  itemId: string
  keyframes: Array<{
    itemId: string
    property: AnimatableProperty
    frame: number
    value: number
    easing: 'linear'
  }>
  clearProperties: AnimatableProperty[]
  clearMotionModifiers: boolean
  clearAudioPulseEffectIds: string[]
}

/**
 * Build the bake plan for the given items — sampling enabled motion modifiers
 * and audio-pulse effects into keyframes. Pure: the caller injects `resolveBase`
 * (which needs canvas + source dims) so this stays free of render/store deps.
 * Feed the result straight to the `bakeMotionToKeyframes` action.
 */
export function buildBakeMotionPlan(params: {
  items: readonly TimelineItem[]
  keyframesByItemId: Record<string, ItemKeyframes>
  fps: number
  frameWidth: number
  frameHeight: number
  resolveBase: (item: TimelineItem) => ResolvedTransform
}): BakeMotionPlanEntry[] {
  const { items, keyframesByItemId, fps, frameWidth, frameHeight, resolveBase } = params

  return items.flatMap((item) => {
    const enabledModifiers = item.motionModifiers?.filter((modifier) => modifier.enabled) ?? []
    const audioEffects = item.effects?.filter((effect) => effect.audioPulse?.enabled) ?? []
    if (enabledModifiers.length === 0 && audioEffects.length === 0) return []

    const itemKeyframes = keyframesByItemId[item.id]
    const keyframes: BakeMotionPlanEntry['keyframes'] = []
    const clearProperties = new Set<AnimatableProperty>()

    if (enabledModifiers.length > 0) {
      const baked = bakeMotionModifiersToKeyframes({
        baseTransform: resolveBase(item),
        keyframes: itemKeyframes,
        modifiers: enabledModifiers,
        durationInFrames: item.durationInFrames,
        fps,
        frameWidth,
        frameHeight,
      })
      for (const property of baked.properties) clearProperties.add(property)
      for (const keyframe of baked.keyframes) {
        keyframes.push({ itemId: item.id, ...keyframe, easing: 'linear' })
      }
    }

    for (const effect of audioEffects) {
      const baked = bakeAudioPulseToKeyframes({
        effectId: effect.id,
        modulation: effect.audioPulse!,
        durationInFrames: item.durationInFrames,
      })
      for (const keyframe of baked) {
        clearProperties.add(keyframe.property)
        keyframes.push({ itemId: item.id, ...keyframe, easing: 'linear' })
      }
    }

    return [
      {
        itemId: item.id,
        keyframes,
        clearProperties: [...clearProperties],
        clearMotionModifiers: enabledModifiers.length > 0,
        clearAudioPulseEffectIds: audioEffects.map((effect) => effect.id),
      },
    ]
  })
}
