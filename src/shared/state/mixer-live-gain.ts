/**
 * Lightweight per-item gain overrides for real-time mixer fader adjustments.
 *
 * During fader drag, the mixer sets linear gain multipliers keyed by itemId.
 * Audio components subscribe per item, so only affected audio nodes re-render.
 * On fader release, overrides are cleared and the committed store value takes over.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'

const DEFAULT_LAYER_ID = 'default'
const overridesByLayerId = new Map<string, Map<string, number>>()
const listenersByItemId = new Map<string, Set<() => void>>()

function notifyItemIds(itemIds: Iterable<string>): void {
  const callbacks = new Set<() => void>()
  for (const itemId of itemIds) {
    const listeners = listenersByItemId.get(itemId)
    if (!listeners) continue
    for (const listener of listeners) {
      callbacks.add(listener)
    }
  }
  for (const callback of callbacks) {
    callback()
  }
}

export function setMixerLiveGains(entries: Array<{ itemId: string; gain: number }>): void {
  setMixerLiveGainLayer(DEFAULT_LAYER_ID, entries)
}

function getMixerLiveGainForItemAcrossLayers(itemId: string): number {
  let gainProduct = 1

  for (const layerOverrides of overridesByLayerId.values()) {
    gainProduct *= layerOverrides.get(itemId) ?? 1
  }

  return gainProduct
}

export function setMixerLiveGainLayer(
  layerId: string,
  entries: Array<{ itemId: string; gain: number }>,
): void {
  if (entries.length === 0) return

  const layerOverrides = overridesByLayerId.get(layerId)
  const previousCombinedGains = new Map<string, number>()

  for (const { itemId } of entries) {
    if (!previousCombinedGains.has(itemId)) {
      previousCombinedGains.set(itemId, getMixerLiveGainForItemAcrossLayers(itemId))
    }
  }

  let nextLayerOverrides = layerOverrides
  for (const { itemId, gain } of entries) {
    const nextGain = Object.is(gain, 1) ? undefined : gain
    if (nextGain === undefined) {
      nextLayerOverrides?.delete(itemId)
      continue
    }

    if (!nextLayerOverrides) {
      nextLayerOverrides = new Map()
      overridesByLayerId.set(layerId, nextLayerOverrides)
    }

    nextLayerOverrides.set(itemId, nextGain)
  }

  if (nextLayerOverrides && nextLayerOverrides.size === 0) {
    overridesByLayerId.delete(layerId)
  }

  const changedItemIds: string[] = []
  for (const [itemId, previousGain] of previousCombinedGains.entries()) {
    if (!Object.is(previousGain, getMixerLiveGainForItemAcrossLayers(itemId))) {
      changedItemIds.push(itemId)
    }
  }

  if (changedItemIds.length > 0) {
    notifyItemIds(changedItemIds)
  }
}

export function clearMixerLiveGainLayer(layerId: string): void {
  const layerOverrides = overridesByLayerId.get(layerId)
  if (!layerOverrides || layerOverrides.size === 0) return

  const previousCombinedGains = new Map<string, number>()
  for (const itemId of layerOverrides.keys()) {
    previousCombinedGains.set(itemId, getMixerLiveGainForItemAcrossLayers(itemId))
  }

  overridesByLayerId.delete(layerId)

  const changedItemIds: string[] = []
  for (const [itemId, previousGain] of previousCombinedGains.entries()) {
    if (!Object.is(previousGain, getMixerLiveGainForItemAcrossLayers(itemId))) {
      changedItemIds.push(itemId)
    }
  }

  if (changedItemIds.length > 0) {
    notifyItemIds(changedItemIds)
  }
}

export function clearMixerLiveGains(): void {
  if (overridesByLayerId.size === 0) return

  const changedItemIds = new Set<string>()
  for (const layerOverrides of overridesByLayerId.values()) {
    for (const itemId of layerOverrides.keys()) {
      changedItemIds.add(itemId)
    }
  }

  overridesByLayerId.clear()
  notifyItemIds(changedItemIds)
}

export function clearMixerLiveGain(itemId: string): void {
  const previousGain = getMixerLiveGainForItemAcrossLayers(itemId)
  let didDelete = false

  for (const [layerId, layerOverrides] of overridesByLayerId.entries()) {
    if (!layerOverrides.delete(itemId)) continue
    didDelete = true
    if (layerOverrides.size === 0) {
      overridesByLayerId.delete(layerId)
    }
  }

  if (didDelete && !Object.is(previousGain, getMixerLiveGainForItemAcrossLayers(itemId))) {
    notifyItemIds([itemId])
  }
}

export function getMixerLiveGain(itemId: string): number {
  return getMixerLiveGainForItemAcrossLayers(itemId)
}

function subscribe(itemId: string, callback: () => void): () => void {
  let listeners = listenersByItemId.get(itemId)
  if (!listeners) {
    listeners = new Set<() => void>()
    listenersByItemId.set(itemId, listeners)
  }

  listeners.add(callback)

  return () => {
    const currentListeners = listenersByItemId.get(itemId)
    if (!currentListeners) return
    currentListeners.delete(callback)
    if (currentListeners.size === 0) {
      listenersByItemId.delete(itemId)
    }
  }
}

function getMixerLiveGainProduct(itemIds: readonly string[]): number {
  let gainProduct = 1
  const seen = new Set<string>()

  for (const itemId of itemIds) {
    if (seen.has(itemId)) continue
    seen.add(itemId)
    gainProduct *= getMixerLiveGain(itemId)
  }

  return gainProduct
}

export function useMixerLiveGainProduct(itemIds: readonly string[]): number {
  const itemIdsKey = itemIds.join('\u0000')
  const stableItemIds = useMemo(
    () => (itemIdsKey.length > 0 ? itemIdsKey.split('\u0000') : []),
    [itemIdsKey],
  )
  const subscribeToItems = useCallback(
    (callback: () => void) => {
      const unsubscribers = stableItemIds.map((itemId) => subscribe(itemId, callback))
      return () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe()
        }
      }
    },
    [stableItemIds],
  )
  const getSnapshot = useCallback(() => getMixerLiveGainProduct(stableItemIds), [stableItemIds])
  return useSyncExternalStore(subscribeToItems, getSnapshot, getSnapshot)
}

export function useMixerLiveGain(itemId: string): number {
  return useMixerLiveGainProduct([itemId])
}
