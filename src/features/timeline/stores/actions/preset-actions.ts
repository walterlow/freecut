/**
 * Animation preset apply — adds a saved preset's keyframes to a target clip as
 * a single undo step (U6, R14).
 *
 * Transform/opacity/text/crop/volume properties map directly. Effect-param
 * properties carry a per-instance `effectId`, so each is remapped onto the
 * target's matching effect by `gpuEffectType`; where the target lacks the
 * effect, it is added from the preset's carried definitions before binding.
 * Compatibility is whole-or-block — `getPresetCompatibility` gates entry and an
 * incompatible target mutates nothing.
 */

import {
  buildEffectAnimatableProperty,
  parseEffectAnimatableProperty,
  type EasingConfig,
  type EasingType,
} from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { AnimationPreset } from '@/infrastructure/storage'
import {
  getAnimatablePropertiesForItem,
  getPresetCompatibility,
  type PresetIncompatibilityReason,
} from '@/features/timeline/deps/keyframe-editors'
import { useItemsStore } from '../items-store'
import { useKeyframesStore, type KeyframeAddPayload } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { captureSnapshot } from '../commands/snapshot'
import { canAddKeyframeAtFrame, getLogger } from './shared'

export interface ApplyAnimationPresetResult {
  applied: number
  addedEffects: number
  skipped: number
  incompatible: boolean
  reason?: PresetIncompatibilityReason | 'no-item'
}

/**
 * Apply `preset` to `targetItemId`, anchoring the preset's frame-0 at
 * `anchorFrame` (clip-relative). Returns counts plus an `incompatible` flag;
 * an incompatible or missing target leaves the timeline untouched.
 */
export function applyAnimationPreset(
  targetItemId: string,
  preset: AnimationPreset,
  anchorFrame = 0,
  options: { replace?: boolean } = {},
): ApplyAnimationPresetResult {
  const item = useItemsStore.getState().itemById[targetItemId]
  if (!item) {
    return { applied: 0, addedEffects: 0, skipped: 0, incompatible: true, reason: 'no-item' }
  }

  const compatibility = getPresetCompatibility(preset, item)
  if (!compatibility.compatible) {
    return {
      applied: 0,
      addedEffects: 0,
      skipped: 0,
      incompatible: true,
      reason: compatibility.reason,
    }
  }

  const beforeSnapshot = captureSnapshot()

  // 1. Resolve the effect-id remap by `gpuEffectType`, adding missing effects.
  const typesNeeded = new Set<string>()
  for (const property of preset.properties) {
    const parsed = parseEffectAnimatableProperty(property.property)
    if (parsed) typesNeeded.add(parsed.gpuEffectType)
  }

  const effectIdByType = new Map<string, string>()
  for (const type of typesNeeded) {
    const existing = item.effects?.find((effect) => effect.effect.gpuEffectType === type)
    if (existing) effectIdByType.set(type, existing.id)
  }

  const effectsToAdd: VisualEffect[] = []
  for (const type of typesNeeded) {
    if (effectIdByType.has(type)) continue
    const presetEffect = preset.effects.find((effect) => effect.gpuEffectType === type)
    // Clone so the applied clip never aliases the in-memory preset's params
    // (a later in-place param edit would otherwise mutate the saved preset).
    if (presetEffect) {
      effectsToAdd.push({ ...presetEffect, params: { ...presetEffect.params } })
    }
  }

  let addedEffects = 0
  if (effectsToAdd.length > 0) {
    useItemsStore.getState()._addEffects([{ itemId: targetItemId, effects: effectsToAdd }])
    addedEffects = effectsToAdd.length

    // Newly added effects are appended at the tail; the last entry of each
    // needed type is the freshly inserted instance.
    const updatedEffects = useItemsStore.getState().itemById[targetItemId]?.effects ?? []
    for (const type of typesNeeded) {
      if (effectIdByType.has(type)) continue
      for (let index = updatedEffects.length - 1; index >= 0; index--) {
        const entry = updatedEffects[index]
        if (entry && entry.effect.gpuEffectType === type) {
          effectIdByType.set(type, entry.id)
          break
        }
      }
    }
  }

  // 2. Build remapped, frame-clamped keyframe payloads.
  const resolvedItem = useItemsStore.getState().itemById[targetItemId] ?? item
  const available = new Set(getAnimatablePropertiesForItem(resolvedItem))
  const maxFrame = Math.max(0, resolvedItem.durationInFrames - 1)

  const payloads: KeyframeAddPayload[] = []
  let skipped = 0

  for (const property of preset.properties) {
    let targetProperty = property.property
    const parsed = parseEffectAnimatableProperty(property.property)
    if (parsed) {
      const targetEffectId = effectIdByType.get(parsed.gpuEffectType)
      if (!targetEffectId) {
        skipped += property.keyframes.length
        continue
      }
      targetProperty = buildEffectAnimatableProperty(
        parsed.gpuEffectType,
        targetEffectId,
        parsed.paramKey,
      )
    } else if (!available.has(targetProperty)) {
      skipped += property.keyframes.length
      continue
    }

    for (const keyframe of property.keyframes) {
      // Known v1 limitation: frames are clamped to the target duration, not
      // retimed. Applying a preset to a clip shorter than its source can
      // collapse trailing keyframes onto the last frame (retiming is deferred
      // per the plan; `sourceDurationInFrames` is captured for a future pass).
      const frame = Math.max(0, Math.min(maxFrame, anchorFrame + keyframe.frame))
      if (!canAddKeyframeAtFrame(targetItemId, frame)) {
        skipped += 1
        continue
      }
      payloads.push({
        itemId: targetItemId,
        property: targetProperty,
        frame,
        value: keyframe.value,
        easing: keyframe.easing as EasingType,
        easingConfig: keyframe.easingConfig as EasingConfig | undefined,
      })
    }
  }

  let applied = 0
  if (payloads.length > 0) {
    const keyframesStore = useKeyframesStore.getState()
    // Replace mode: drop existing keyframes on the properties this preset writes
    // so reapplying a saved animation swaps it instead of merging frame-by-frame.
    // Same undo block as the add (captureSnapshot was taken above).
    if (options.replace) {
      const replacedProperties = new Set(payloads.map((payload) => payload.property))
      for (const property of replacedProperties) {
        keyframesStore._removeKeyframesForProperty(targetItemId, property)
      }
    }
    applied = keyframesStore._addKeyframes(payloads).length
  }

  if (applied > 0 || addedEffects > 0) {
    useTimelineSettingsStore.getState().markDirty()
    useTimelineCommandStore
      .getState()
      .addUndoEntry(
        { type: 'APPLY_ANIMATION_PRESET', payload: { targetItemId, presetId: preset.id } },
        beforeSnapshot,
      )
  } else {
    getLogger().warn('applyAnimationPreset produced no keyframes', { targetItemId, skipped })
  }

  return { applied, addedEffects, skipped, incompatible: false }
}
