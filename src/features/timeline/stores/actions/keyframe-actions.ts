/**
 * Keyframe Actions - Animation keyframe operations with undo/redo support.
 */

import type { AnimatableProperty, EasingType, Keyframe, KeyframeRef } from '@/types/keyframe'
import type { KeyframeAddPayload, KeyframeUpdatePayload } from '../keyframes-store'
import type { AutoKeyframeOperation } from '@/features/timeline/deps/keyframes'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute, getLogger, canAddKeyframeAtFrame } from './shared'

export function addKeyframe(
  itemId: string,
  property: AnimatableProperty,
  frame: number,
  value: number,
  easing?: EasingType,
): string {
  // Validate: keyframes cannot be added in transition regions
  if (!canAddKeyframeAtFrame(itemId, frame)) {
    getLogger().warn('Cannot add keyframe in transition region', { itemId, property, frame })
    return ''
  }

  return execute(
    'ADD_KEYFRAME',
    () => {
      const id = useKeyframesStore.getState()._addKeyframe(itemId, property, frame, value, easing)
      useTimelineSettingsStore.getState().markDirty()
      return id
    },
    { itemId, property, frame },
  )
}

/**
 * Add multiple keyframes at once (batched as single undo operation).
 * Keyframes in transition regions are filtered out.
 */
export function addKeyframes(payloads: KeyframeAddPayload[]): string[] {
  if (payloads.length === 0) return []

  // Filter out keyframes that would be placed in transition regions
  const validPayloads = payloads.filter((p) => canAddKeyframeAtFrame(p.itemId, p.frame))

  if (validPayloads.length === 0) {
    getLogger().warn('All keyframes blocked by transition regions', {
      originalCount: payloads.length,
    })
    return []
  }

  if (validPayloads.length < payloads.length) {
    getLogger().warn('Some keyframes blocked by transition regions', {
      originalCount: payloads.length,
      validCount: validPayloads.length,
    })
  }

  return execute(
    'ADD_KEYFRAMES',
    () => {
      const ids = useKeyframesStore.getState()._addKeyframes(validPayloads)
      useTimelineSettingsStore.getState().markDirty()
      return ids
    },
    { count: validPayloads.length },
  )
}

/**
 * One property to clear before a preset applies. With `fromFrame`/`toFrame` only
 * keyframes inside that window are removed (region-aware Replace — a new entrance
 * preset clears the entrance window across all preset-owned properties while an
 * exit at the other end survives); without a range the whole property is cleared.
 */
export interface MotionPresetClear {
  itemId: string
  property: AnimatableProperty
  fromFrame?: number
  toFrame?: number
}

/**
 * Apply a motion preset's keyframes, optionally clearing target properties first
 * so reapplying a preset REPLACES the previous one instead of silently
 * overwriting only the frames that collide. The clear + add run inside a single
 * undo block so one Ctrl+Z reverts the whole apply.
 */
export function applyMotionPresetKeyframes(
  payloads: KeyframeAddPayload[],
  clearProperties: MotionPresetClear[] = [],
): string[] {
  if (payloads.length === 0) return []

  const validPayloads = payloads.filter((p) => canAddKeyframeAtFrame(p.itemId, p.frame))
  // All-or-nothing: if ANY payload is blocked (e.g. lands in a transition
  // region), abort before the clear loop runs. The clear windows are derived
  // from the pre-filtered set, so clearing while only some replacements survive
  // would silently delete keyframes we can't re-add. A partial apply must be a
  // no-op instead.
  if (validPayloads.length < payloads.length) {
    getLogger().warn('Preset keyframes blocked by transition regions; skipping apply', {
      originalCount: payloads.length,
      validCount: validPayloads.length,
    })
    return []
  }

  return execute(
    'APPLY_MOTION_PRESET_KEYFRAMES',
    () => {
      const keyframesStore = useKeyframesStore.getState()
      for (const clear of clearProperties) {
        if (clear.fromFrame === undefined || clear.toFrame === undefined) {
          keyframesStore._removeKeyframesForProperty(clear.itemId, clear.property)
          continue
        }
        const group = keyframesStore.keyframesByItemId[clear.itemId]?.properties.find(
          (entry) => entry.property === clear.property,
        )
        if (!group) continue
        const refs = group.keyframes
          .filter((kf) => kf.frame >= clear.fromFrame! && kf.frame <= clear.toFrame!)
          .map((kf) => ({ itemId: clear.itemId, property: clear.property, keyframeId: kf.id }))
        if (refs.length > 0) keyframesStore._removeKeyframes(refs)
      }
      const ids = keyframesStore._addKeyframes(validPayloads)
      useTimelineSettingsStore.getState().markDirty()
      return ids
    },
    { count: validPayloads.length, cleared: clearProperties.length },
  )
}

export function updateKeyframe(
  itemId: string,
  property: AnimatableProperty,
  keyframeId: string,
  updates: Partial<Omit<Keyframe, 'id'>>,
): void {
  if (typeof updates.frame === 'number' && !canAddKeyframeAtFrame(itemId, updates.frame)) {
    getLogger().warn('Cannot move keyframe into transition region', {
      itemId,
      property,
      keyframeId,
      frame: updates.frame,
    })
    return
  }

  execute(
    'UPDATE_KEYFRAME',
    () => {
      useKeyframesStore.getState()._updateKeyframe(itemId, property, keyframeId, updates)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property, keyframeId },
  )
}

export function updateKeyframes(updates: KeyframeUpdatePayload[]): void {
  if (updates.length === 0) return

  const validUpdates = updates.filter((update) => {
    if (typeof update.updates.frame !== 'number') {
      return true
    }

    const allowed = canAddKeyframeAtFrame(update.itemId, update.updates.frame)
    if (!allowed) {
      getLogger().warn('Cannot move keyframe into transition region', {
        itemId: update.itemId,
        property: update.property,
        keyframeId: update.keyframeId,
        frame: update.updates.frame,
      })
    }
    return allowed
  })

  if (validUpdates.length === 0) return

  execute(
    'UPDATE_KEYFRAMES',
    () => {
      useKeyframesStore.getState()._updateKeyframes(validUpdates)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: validUpdates.length },
  )
}

/**
 * Apply mixed auto-keyframe operations (adds + updates) in a single undo block.
 */
export function applyAutoKeyframeOperations(operations: AutoKeyframeOperation[]): void {
  if (operations.length === 0) return

  execute(
    'APPLY_AUTO_KEYFRAME_OPERATIONS',
    () => {
      const keyframesStore = useKeyframesStore.getState()
      let changed = false

      for (const operation of operations) {
        if (operation.type === 'update') {
          keyframesStore._updateKeyframe(
            operation.itemId,
            operation.property,
            operation.keyframeId,
            operation.updates,
          )
          changed = true
          continue
        }

        if (!canAddKeyframeAtFrame(operation.itemId, operation.frame)) {
          getLogger().warn('Cannot add auto keyframe in transition region', {
            itemId: operation.itemId,
            property: operation.property,
            frame: operation.frame,
          })
          continue
        }

        keyframesStore._addKeyframe(
          operation.itemId,
          operation.property,
          operation.frame,
          operation.value,
          operation.easing,
        )
        changed = true
      }

      if (changed) {
        useTimelineSettingsStore.getState().markDirty()
      }
    },
    { count: operations.length },
  )
}

export function removeKeyframe(
  itemId: string,
  property: AnimatableProperty,
  keyframeId: string,
): void {
  execute(
    'REMOVE_KEYFRAME',
    () => {
      useKeyframesStore.getState()._removeKeyframe(itemId, property, keyframeId)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property, keyframeId },
  )
}

export function removeKeyframesForItem(itemId: string): void {
  execute(
    'REMOVE_KEYFRAMES_FOR_ITEM',
    () => {
      useKeyframesStore.getState()._removeKeyframesForItem(itemId)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId },
  )
}

export function removeKeyframesForProperty(itemId: string, property: AnimatableProperty): void {
  execute(
    'REMOVE_KEYFRAMES_FOR_PROPERTY',
    () => {
      useKeyframesStore.getState()._removeKeyframesForProperty(itemId, property)
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId, property },
  )
}

// Read-only keyframe helpers (no undo needed)
export function getKeyframesForItem(itemId: string) {
  return useKeyframesStore.getState().getKeyframesForItem(itemId)
}

export function hasKeyframesAtFrame(
  itemId: string,
  property: AnimatableProperty,
  frame: number,
): boolean {
  return useKeyframesStore.getState().hasKeyframesAtFrame(itemId, property, frame)
}

/**
 * Remove multiple keyframes at once.
 */
export function removeKeyframes(refs: KeyframeRef[]): void {
  if (refs.length === 0) return

  execute(
    'REMOVE_KEYFRAMES',
    () => {
      useKeyframesStore.getState()._removeKeyframes(refs)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: refs.length },
  )
}
