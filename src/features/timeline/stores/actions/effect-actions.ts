/**
 * Effect Actions - Visual effect operations with undo/redo support.
 */

import type { ItemEffect, VisualEffect } from '@/types/effects'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute } from './shared'
import { requestPostEditWarmForItems } from './edit/shared'
import { emitUiSound } from '@/shared/ui/ui-sound'

export function addEffect(itemId: string, effect: VisualEffect): void {
  execute(
    'ADD_EFFECT',
    () => {
      useItemsStore.getState()._addEffect(itemId, effect)
      useTimelineSettingsStore.getState().markDirty()
      requestPostEditWarmForItems([itemId])
    },
    { itemId, effectType: effect.type },
  )
}

export function addEffects(updates: Array<{ itemId: string; effects: VisualEffect[] }>): void {
  execute(
    'ADD_EFFECTS',
    () => {
      useItemsStore.getState()._addEffects(updates)
      useTimelineSettingsStore.getState().markDirty()
      requestPostEditWarmForItems(updates.map((u) => u.itemId))
    },
    { count: updates.length },
  )
}

export function updateEffect(
  itemId: string,
  effectId: string,
  updates: Partial<{ effect: VisualEffect; enabled: boolean }>,
): void {
  execute(
    'UPDATE_EFFECT',
    () => {
      useItemsStore.getState()._updateEffect(itemId, effectId, updates)
      useTimelineSettingsStore.getState().markDirty()
      requestPostEditWarmForItems([itemId])
    },
    { itemId, effectId },
  )
}

export function removeEffect(itemId: string, effectId: string): void {
  execute(
    'REMOVE_EFFECT',
    () => {
      useItemsStore.getState()._removeEffect(itemId, effectId)
      useTimelineSettingsStore.getState().markDirty()
      requestPostEditWarmForItems([itemId])
    },
    { itemId, effectId },
  )
}

export function clearEffects(itemId: string): void {
  execute(
    'CLEAR_EFFECTS',
    () => {
      useItemsStore.getState()._clearEffects(itemId)
      useTimelineSettingsStore.getState().markDirty()
      requestPostEditWarmForItems([itemId])
    },
    { itemId },
  )
}

/**
 * Replace the full effects list on multiple items as one undo step.
 * Used for effect reordering and grade paste, where the new list is
 * derived from the existing one (retained effects keep their ids).
 */
export function setItemEffects(updates: Array<{ itemId: string; effects: ItemEffect[] }>): void {
  execute(
    'SET_ITEM_EFFECTS',
    () => {
      useItemsStore.getState()._setItemEffects(updates)
      useTimelineSettingsStore.getState().markDirty()
      requestPostEditWarmForItems(updates.map((u) => u.itemId))
    },
    { count: updates.length },
  )
}

export function toggleEffect(itemId: string, effectId: string): void {
  const wasEnabled = useItemsStore
    .getState()
    .items.find((item) => item.id === itemId)
    ?.effects?.find((effect) => effect.id === effectId)?.enabled
  execute(
    'TOGGLE_EFFECT',
    () => {
      useItemsStore.getState()._toggleEffect(itemId, effectId)
      useTimelineSettingsStore.getState().markDirty()
      requestPostEditWarmForItems([itemId])
    },
    { itemId, effectId },
  )
  emitUiSound(wasEnabled ? 'toggleOff' : 'toggleOn')
}
