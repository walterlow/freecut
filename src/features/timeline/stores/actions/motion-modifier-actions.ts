/**
 * Motion modifier actions — attach/remove procedural motion modifiers on items.
 *
 * Modifiers live on the timeline item (like effects), so these wrap
 * `_updateItem` in a single undo block. Applying a modifier replaces any
 * existing modifier of the same type on that item (apply == set, not stack).
 */

import type { MotionModifier, MotionModifierType } from '@/types/motion'
import type { AudioPulseModulation } from '@/types/effects'
import type { AnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useKeyframesStore, type KeyframeAddPayload } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute, canAddKeyframeAtFrame } from './shared'

export interface MotionModifierAssignment {
  itemId: string
  modifier: MotionModifier
}

function withModifier(
  existing: MotionModifier[] | undefined,
  modifier: MotionModifier,
): MotionModifier[] {
  const kept = (existing ?? []).filter((entry) => entry.type !== modifier.type)
  return [...kept, modifier]
}

/**
 * Apply one modifier to each listed item (single undo entry). Replaces any
 * existing modifier of the same type. Returns the number of items updated.
 */
export function applyMotionModifierToItems(assignments: MotionModifierAssignment[]): number {
  if (assignments.length === 0) return 0

  return execute(
    'APPLY_MOTION_MODIFIERS',
    () => {
      const store = useItemsStore.getState()
      let updated = 0
      for (const { itemId, modifier } of assignments) {
        const item = store.itemById[itemId]
        if (!item) continue
        store._updateItem(itemId, {
          motionModifiers: withModifier(item.motionModifiers, modifier),
        })
        updated += 1
      }
      if (updated > 0) {
        useTimelineSettingsStore.getState().markDirty()
      }
      return updated
    },
    { count: assignments.length },
  )
}

export interface BakeMotionPlanEntry {
  itemId: string
  /** Baked keyframes to add (already item-scoped). */
  keyframes: KeyframeAddPayload[]
  /** Properties whose existing keyframes are wiped before adding the baked set. */
  clearProperties: AnimatableProperty[]
  /** Drop all transform motion modifiers from the item. */
  clearMotionModifiers: boolean
  /** Effect ids whose audio-pulse modulation should be removed. */
  clearAudioPulseEffectIds: string[]
}

/**
 * Bake procedural motion into keyframes: replace the baked properties' keyframes
 * with the sampled set and drop the procedural sources — all in one undo entry.
 * Returns the number of items baked.
 */
export function bakeMotionToKeyframes(plan: BakeMotionPlanEntry[]): number {
  if (plan.length === 0) return 0

  return execute(
    'BAKE_MOTION_TO_KEYFRAMES',
    () => {
      const itemsStore = useItemsStore.getState()
      const keyframesStore = useKeyframesStore.getState()
      let baked = 0

      for (const entry of plan) {
        const item = itemsStore.itemById[entry.itemId]
        if (!item) continue

        for (const property of entry.clearProperties) {
          keyframesStore._removeKeyframesForProperty(entry.itemId, property)
        }

        const valid = entry.keyframes.filter((payload) =>
          canAddKeyframeAtFrame(payload.itemId, payload.frame),
        )
        if (valid.length > 0) {
          keyframesStore._addKeyframes(valid)
        }

        const updates: Partial<TimelineItem> = {}
        if (entry.clearMotionModifiers) {
          updates.motionModifiers = []
        }
        if (entry.clearAudioPulseEffectIds.length > 0 && item.effects) {
          const ids = new Set(entry.clearAudioPulseEffectIds)
          updates.effects = item.effects.map((effect) =>
            ids.has(effect.id) ? { ...effect, audioPulse: undefined } : effect,
          )
        }
        if (Object.keys(updates).length > 0) {
          itemsStore._updateItem(entry.itemId, updates)
        }

        baked += 1
      }

      if (baked > 0) {
        useTimelineSettingsStore.getState().markDirty()
      }
      return baked
    },
    { count: plan.length },
  )
}

/**
 * Attach (or replace) a procedural audio-pulse modulation on a specific effect
 * entry of an item. Single undo entry. Returns true when applied.
 */
export function setEffectAudioPulse(
  itemId: string,
  effectId: string,
  modulation: AudioPulseModulation,
): boolean {
  return execute(
    'SET_EFFECT_AUDIO_PULSE',
    () => {
      const store = useItemsStore.getState()
      const item = store.itemById[itemId]
      if (!item?.effects?.some((entry) => entry.id === effectId)) return false
      store._updateItem(itemId, {
        effects: item.effects.map((entry) =>
          entry.id === effectId ? { ...entry, audioPulse: modulation } : entry,
        ),
      })
      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { itemId, effectId },
  )
}

/**
 * Remove a modifier type from each listed item (single undo entry). Returns the
 * number of items that actually had the modifier removed.
 */
export function removeMotionModifierFromItems(itemIds: string[], type: MotionModifierType): number {
  if (itemIds.length === 0) return 0

  return execute(
    'REMOVE_MOTION_MODIFIERS',
    () => {
      const store = useItemsStore.getState()
      let updated = 0
      for (const itemId of itemIds) {
        const item = store.itemById[itemId]
        if (!item?.motionModifiers?.some((entry) => entry.type === type)) continue
        store._updateItem(itemId, {
          motionModifiers: item.motionModifiers.filter((entry) => entry.type !== type),
        })
        updated += 1
      }
      if (updated > 0) {
        useTimelineSettingsStore.getState().markDirty()
      }
      return updated
    },
    { count: itemIds.length, type },
  )
}
