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
  cloneVectorKeyframe,
  parseEffectAnimatableProperty,
  type EasingConfig,
  type EasingType,
  type AnimationKeyframeSource,
  type VectorAnimatableProperty,
  type VectorKeyframe,
  type VectorPropertyKeyframes,
} from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { MotionModifier } from '@/types/motion'
import type { TextMotionSpec } from '@/types/text-motion'
import type { AnimationPreset } from '@/infrastructure/storage'
import {
  getAnimatablePropertiesForItem,
  getPresetCompatibility,
  cloneMotionAnimationLayer,
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
  appliedProcedural: number
  skipped: number
  incompatible: boolean
  reason?: PresetIncompatibilityReason | 'no-item'
}

function cloneMotionModifierForTarget(modifier: MotionModifier): MotionModifier {
  return {
    ...modifier,
    id: crypto.randomUUID(),
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

function mergeMotionModifiers(
  existing: readonly MotionModifier[] | undefined,
  incoming: readonly MotionModifier[],
): MotionModifier[] {
  const incomingTypes = new Set(incoming.map((modifier) => modifier.type))
  return [...(existing ?? []).filter((modifier) => !incomingTypes.has(modifier.type)), ...incoming]
}

const VECTOR_SCALAR_PROPERTIES: Record<
  VectorAnimatableProperty,
  ['x', 'y'] | ['width', 'height'] | ['anchorX', 'anchorY']
> = {
  position: ['x', 'y'],
  scale: ['width', 'height'],
  anchor: ['anchorX', 'anchorY'],
}

function resolvePresetVectorKeyframes(params: {
  targetItemId: string
  keyframes: VectorKeyframe[]
  anchorFrame: number
  maxFrame: number
  retimeFrame: (frame: number) => number
  source: AnimationKeyframeSource
  timeScale: number
}): { keyframes: VectorKeyframe[]; applied: number; skipped: number } {
  const { targetItemId, keyframes, anchorFrame, maxFrame, retimeFrame, source, timeScale } = params
  const byFrame = new Map<number, VectorKeyframe>()
  let applied = 0
  let skipped = 0

  for (const keyframe of keyframes) {
    const frame = Math.max(0, Math.min(maxFrame, anchorFrame + retimeFrame(keyframe.frame)))
    if (!canAddKeyframeAtFrame(targetItemId, frame)) {
      skipped += 1
      continue
    }
    byFrame.set(frame, {
      ...cloneVectorKeyframe(keyframe, { id: crypto.randomUUID(), frame }),
      source,
      ...(keyframe.temporalEase && {
        temporalEase: {
          ...(keyframe.temporalEase.in && {
            in: {
              ...keyframe.temporalEase.in,
              speed:
                timeScale > 0
                  ? keyframe.temporalEase.in.speed / timeScale
                  : keyframe.temporalEase.in.speed,
            },
          }),
          ...(keyframe.temporalEase.out && {
            out: {
              ...keyframe.temporalEase.out,
              speed:
                timeScale > 0
                  ? keyframe.temporalEase.out.speed / timeScale
                  : keyframe.temporalEase.out.speed,
            },
          }),
        },
      }),
    })
    applied += 1
  }

  return {
    keyframes: [...byFrame.values()].sort((left, right) => left.frame - right.frame),
    applied,
    skipped,
  }
}

function mergeVectorPropertyKeyframes(
  property: VectorAnimatableProperty,
  existing: VectorKeyframe[],
  incoming: VectorKeyframe[],
  replace: boolean,
  replaceRange?: { fromFrame: number; toFrame: number },
): VectorPropertyKeyframes {
  const byFrame = new Map<number, VectorKeyframe>()
  for (const keyframe of existing) {
    if (
      replace &&
      replaceRange &&
      keyframe.frame >= replaceRange.fromFrame &&
      keyframe.frame <= replaceRange.toFrame
    ) {
      continue
    }
    byFrame.set(keyframe.frame, keyframe)
  }
  for (const keyframe of incoming) {
    const existingAtFrame = byFrame.get(keyframe.frame)
    // Merge is non-destructive: an authored key already at this frame wins.
    // Replace removes the range above, so no collision remains in that mode.
    if (!existingAtFrame) byFrame.set(keyframe.frame, keyframe)
  }
  return {
    property,
    keyframes: [...byFrame.values()].sort((left, right) => left.frame - right.frame),
  }
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
  options: { replace?: boolean; retime?: boolean } = {},
): ApplyAnimationPresetResult {
  const item = useItemsStore.getState().itemById[targetItemId]
  if (!item) {
    return {
      applied: 0,
      addedEffects: 0,
      appliedProcedural: 0,
      skipped: 0,
      incompatible: true,
      reason: 'no-item',
    }
  }

  const compatibility = getPresetCompatibility(preset, item)
  if (!compatibility.compatible) {
    return {
      applied: 0,
      addedEffects: 0,
      appliedProcedural: 0,
      skipped: 0,
      incompatible: true,
      reason: compatibility.reason,
    }
  }

  const beforeSnapshot = captureSnapshot()
  const applicationId = crypto.randomUUID()
  const source: AnimationKeyframeSource = {
    applicationId,
    kind: 'saved-preset',
    presetId: preset.id,
    presetName: preset.name,
  }

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
  const sourceLastFrame = Math.max(1, preset.sourceDurationInFrames - 1)
  const targetAvailableFrames = Math.max(0, maxFrame - anchorFrame)
  const timeScale = options.retime === false ? 1 : targetAvailableFrames / sourceLastFrame
  const retimeFrame = (frame: number) =>
    options.retime === false ? frame : Math.round(frame * timeScale)

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
      const frame = Math.max(0, Math.min(maxFrame, anchorFrame + retimeFrame(keyframe.frame)))
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
        source,
      })
    }
  }

  let applied = 0
  if (payloads.length > 0) {
    const keyframesStore = useKeyframesStore.getState()
    let payloadsToAdd = payloads
    // Replace only the authored window, matching built-in presets. Keyframes
    // before/after the incoming recipe survive; Merge keeps the whole lane.
    if (options.replace) {
      const replacedProperties = new Set(payloads.map((payload) => payload.property))
      for (const property of replacedProperties) {
        const incoming = payloads.filter((payload) => payload.property === property)
        const fromFrame = Math.min(...incoming.map((payload) => payload.frame))
        const toFrame = Math.max(...incoming.map((payload) => payload.frame))
        const refs =
          keyframesStore
            .getKeyframesForItem(targetItemId)
            ?.properties.find((candidate) => candidate.property === property)
            ?.keyframes.filter(
              (keyframe) => keyframe.frame >= fromFrame && keyframe.frame <= toFrame,
            )
            .map((keyframe) => ({
              itemId: targetItemId,
              property,
              keyframeId: keyframe.id,
            })) ?? []
        if (refs.length > 0) keyframesStore._removeKeyframes(refs)
      }
    } else {
      // Merge adds missing diamonds but never changes an authored key already
      // occupying the same property/frame.
      const current = keyframesStore.getKeyframesForItem(targetItemId)
      payloadsToAdd = payloads.filter((payload) => {
        const lane = current?.properties.find(
          (candidate) => candidate.property === payload.property,
        )
        return !lane?.keyframes.some((keyframe) => keyframe.frame === payload.frame)
      })
      skipped += payloads.length - payloadsToAdd.length
    }
    applied = keyframesStore._addKeyframes(payloadsToAdd).length
  }

  const keyframesStore = useKeyframesStore.getState()
  for (const property of preset.vectorProperties ?? []) {
    const resolved = resolvePresetVectorKeyframes({
      targetItemId,
      keyframes: property.keyframes,
      anchorFrame,
      maxFrame,
      retimeFrame,
      source,
      timeScale,
    })
    skipped += resolved.skipped
    if (resolved.keyframes.length === 0) continue

    const existing =
      keyframesStore
        .getKeyframesForItem(targetItemId)
        ?.vectorProperties?.find((candidate) => candidate.property === property.property)
        ?.keyframes ?? []
    const incomingKeyframes = options.replace
      ? resolved.keyframes
      : resolved.keyframes.filter(
          (keyframe) => !existing.some((candidate) => candidate.frame === keyframe.frame),
        )
    skipped += resolved.keyframes.length - incomingKeyframes.length
    if (incomingKeyframes.length === 0) continue
    const replaceRange =
      options.replace === true
        ? {
            fromFrame: Math.min(...incomingKeyframes.map((keyframe) => keyframe.frame)),
            toFrame: Math.max(...incomingKeyframes.map((keyframe) => keyframe.frame)),
          }
        : undefined
    keyframesStore._replaceScalarPropertiesWithVectorProperty(
      targetItemId,
      mergeVectorPropertyKeyframes(
        property.property,
        existing,
        incomingKeyframes,
        options.replace === true,
        replaceRange,
      ),
      VECTOR_SCALAR_PROPERTIES[property.property],
    )
    applied += incomingKeyframes.length
  }

  // 3. Restore the live parts of the recipe. Replace mode makes the saved
  // procedural set authoritative; Add mode merges modifier types and text
  // slots while preserving unrelated live motion on the target.
  let appliedProcedural = 0
  const itemsStore = useItemsStore.getState()
  if (preset.motionModifiers && preset.motionModifiers.length > 0) {
    const incoming = preset.motionModifiers.map(cloneMotionModifierForTarget)
    itemsStore._updateItem(targetItemId, {
      motionModifiers: options.replace
        ? incoming
        : mergeMotionModifiers(item.motionModifiers, incoming),
    })
    appliedProcedural += incoming.length
  }
  if (preset.motionLayers && preset.motionLayers.length > 0) {
    const incoming = preset.motionLayers.map((layer) => ({
      ...cloneMotionAnimationLayer(layer, { freshIds: true }),
      source: 'saved-preset' as const,
      sourcePresetId: preset.id,
    }))
    itemsStore._updateItem(targetItemId, {
      motionLayers: options.replace ? incoming : [...(item.motionLayers ?? []), ...incoming],
    })
    appliedProcedural += incoming.length
  }
  if (preset.textMotion && item.type === 'text') {
    const incoming = cloneTextMotion(preset.textMotion)
    itemsStore._updateItem(targetItemId, {
      textMotion: options.replace ? incoming : { ...item.textMotion, ...incoming },
    })
    appliedProcedural += Number(Boolean(incoming.in))
    appliedProcedural += Number(Boolean(incoming.out))
    appliedProcedural += Number(Boolean(incoming.loop))
  }

  if (applied > 0 || addedEffects > 0 || appliedProcedural > 0) {
    useTimelineSettingsStore.getState().markDirty()
    useTimelineCommandStore
      .getState()
      .addUndoEntry(
        { type: 'APPLY_ANIMATION_PRESET', payload: { targetItemId, presetId: preset.id } },
        beforeSnapshot,
      )
  } else {
    getLogger().warn('applyAnimationPreset produced no animation', { targetItemId, skipped })
  }

  return { applied, addedEffects, appliedProcedural, skipped, incompatible: false }
}
