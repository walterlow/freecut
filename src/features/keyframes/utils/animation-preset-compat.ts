/**
 * Animation preset capture + compatibility helpers (U6).
 *
 * Pure functions only — no store access. Capture reads a clip's keyframes into
 * a portable, frame-normalized preset payload; compatibility decides whether a
 * preset can be applied whole to a target clip (R14, whole-or-block). The
 * effect-id remap and the actual undo-integrated mutation live in the timeline
 * `applyAnimationPreset` action, which consumes these helpers.
 */

import {
  cloneVectorKeyframe,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
  type ItemKeyframes,
} from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import type { MotionModifier } from '@/types/motion'
import { cloneMotionAnimationLayer } from './motion-layer-eval'
import type { TextMotionSpec } from '@/types/text-motion'
import type {
  AnimationPreset,
  AnimationPresetProperty,
  AnimationPresetVectorProperty,
} from '@/infrastructure/storage'
import { getAnimatablePropertiesForItem } from './animatable-properties'

/** The portion of an {@link AnimationPreset} derived purely from a source clip. */
export interface CapturedAnimation {
  sourceItemType: TimelineItem['type']
  properties: AnimationPresetProperty[]
  vectorProperties?: AnimationPresetVectorProperty[]
  effects: VisualEffect[]
  motionModifiers?: MotionModifier[]
  motionLayers?: import('@/types/motion').MotionAnimationLayer[]
  textMotion?: TextMotionSpec
  sourceDurationInFrames: number
}

function cloneMotionModifier(modifier: MotionModifier): MotionModifier {
  return {
    ...modifier,
    ...(modifier.channelGains && { channelGains: { ...modifier.channelGains } }),
  }
}

function cloneTextMotion(spec: TextMotionSpec): TextMotionSpec {
  return {
    ...(spec.in && { in: { ...spec.in } }),
    ...(spec.out && { out: { ...spec.out } }),
    ...(spec.loop && { loop: { ...spec.loop } }),
  }
}

/** Why a preset cannot be applied to a target — drives the disabled-state tooltip. */
export type PresetIncompatibilityReason = 'type-mismatch' | 'missing-property'

export interface PresetCompatibility {
  compatible: boolean
  reason?: PresetIncompatibilityReason
}

/**
 * Capture the animated properties of `item` into a portable preset payload.
 * Frames are normalized so the earliest keyframe across all properties sits at
 * 0. Returns `null` when the clip has no keyframes worth saving.
 */
export function captureAnimationFromItem(
  item: TimelineItem,
  itemKeyframes: ItemKeyframes | undefined,
): CapturedAnimation | null {
  const animated = (itemKeyframes?.properties ?? []).filter(
    (property) => property.keyframes.length > 0,
  )
  const animatedVectors = (itemKeyframes?.vectorProperties ?? []).filter(
    (property) => property.keyframes.length > 0,
  )
  const motionModifiers = (item.motionModifiers ?? [])
    .filter((modifier) => modifier.enabled && modifier.amplitude > 0)
    .map(cloneMotionModifier)
  const motionLayers = (item.motionLayers ?? [])
    .filter((layer) => layer.enabled && layer.tracks.length > 0)
    .map((layer) => cloneMotionAnimationLayer(layer))
  const textMotion =
    item.type === 'text' && item.textMotion ? cloneTextMotion(item.textMotion) : undefined
  if (
    animated.length === 0 &&
    animatedVectors.length === 0 &&
    motionModifiers.length === 0 &&
    motionLayers.length === 0 &&
    !textMotion
  ) {
    return null
  }

  const animatedFrames = [
    ...animated.flatMap((property) => property.keyframes.map((keyframe) => keyframe.frame)),
    ...animatedVectors.flatMap((property) => property.keyframes.map((keyframe) => keyframe.frame)),
  ]
  const minFrame = animatedFrames.length > 0 ? Math.min(...animatedFrames) : 0

  const properties: AnimationPresetProperty[] = animated.map((property) => ({
    property: property.property,
    keyframes: property.keyframes
      .toSorted((a, b) => a.frame - b.frame)
      .map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame - minFrame,
        value: keyframe.value,
        easing: keyframe.easing,
        easingConfig: keyframe.easingConfig,
      })),
  }))
  const vectorProperties: AnimationPresetVectorProperty[] = animatedVectors.map((property) => ({
    property: property.property,
    keyframes: property.keyframes
      .toSorted((left, right) => left.frame - right.frame)
      .map((keyframe) => {
        const cloned = cloneVectorKeyframe(keyframe, { frame: keyframe.frame - minFrame })
        delete cloned.source
        return cloned
      }),
  }))

  // Carry the effect definitions the effect-param keyframes animate so a target
  // missing the effect can have it added on apply. Dedupe by effect type — the
  // remap matches targets by `gpuEffectType`.
  //
  // Known v1 limitation: a source clip animating two *instances* of the same
  // effect type collapses to one carried definition, and apply remaps both
  // property groups onto a single target effect. Disambiguating same-type
  // instances would need an instance-mapping scheme beyond the plan's
  // by-`gpuEffectType` remap.
  const effects: VisualEffect[] = []
  const seenTypes = new Set<string>()
  for (const property of animated) {
    const parsed = parseEffectAnimatableProperty(property.property)
    if (!parsed) continue
    if (seenTypes.has(parsed.gpuEffectType)) continue
    const entry = item.effects?.find((effect) => effect.id === parsed.effectId)
    if (entry) {
      effects.push(entry.effect)
      seenTypes.add(parsed.gpuEffectType)
    }
  }

  return {
    sourceItemType: item.type,
    properties,
    ...(vectorProperties.length > 0 && { vectorProperties }),
    effects,
    ...(motionModifiers.length > 0 && { motionModifiers }),
    ...(motionLayers.length > 0 && { motionLayers }),
    ...(textMotion && { textMotion }),
    sourceDurationInFrames: item.durationInFrames,
  }
}

/**
 * Whether `preset` can be applied whole to `targetItem` (R14). Compatible means
 * the source type matches and every non-effect property the preset animates is
 * hostable on the target. Effect-param properties never block: a target missing
 * the effect gets it added from the preset's carried definitions on apply.
 */
export function getPresetCompatibility(
  preset: Pick<AnimationPreset, 'sourceItemType' | 'properties' | 'vectorProperties'>,
  targetItem: TimelineItem,
): PresetCompatibility {
  if (preset.sourceItemType !== targetItem.type) {
    return { compatible: false, reason: 'type-mismatch' }
  }

  const available = new Set<AnimatableProperty>(getAnimatablePropertiesForItem(targetItem))
  for (const property of preset.properties) {
    if (parseEffectAnimatableProperty(property.property)) {
      continue
    }
    if (!available.has(property.property)) {
      return { compatible: false, reason: 'missing-property' }
    }
  }

  for (const property of preset.vectorProperties ?? []) {
    const requiredProperties =
      property.property === 'position'
        ? (['x', 'y'] as const)
        : property.property === 'scale'
          ? (['width', 'height'] as const)
          : (['anchorX', 'anchorY'] as const)
    if (!requiredProperties.every((required) => available.has(required))) {
      return { compatible: false, reason: 'missing-property' }
    }
  }

  return { compatible: true }
}
