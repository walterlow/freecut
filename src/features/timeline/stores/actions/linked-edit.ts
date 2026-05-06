import type { TimelineItem } from '@/types/timeline'
import {
  buildSynchronizedLinkedMoveUpdates,
  expandItemIdsWithAttachedCaptions,
  expandSelectionWithLinkedItems,
  getLinkedItems,
  getMatchingSynchronizedLinkedCounterpart,
  getSynchronizedLinkedCounterpartPair,
  getSynchronizedLinkedItems,
} from '@/features/timeline/utils/linked-items'

function getAnchorItem(items: TimelineItem[], itemId: string): TimelineItem[] {
  const anchor = items.find((item) => item.id === itemId)
  return anchor ? [anchor] : []
}

export function expandIdsWithLinkedItems(
  items: TimelineItem[],
  ids: string[],
  linkedSelectionEnabled: boolean,
): string[] {
  if (!linkedSelectionEnabled) {
    return expandItemIdsWithAttachedCaptions(items, Array.from(new Set(ids)))
  }

  return expandItemIdsWithAttachedCaptions(items, expandSelectionWithLinkedItems(items, ids))
}

export function getLinkedItemsForEdit(
  items: TimelineItem[],
  itemId: string,
  linkedSelectionEnabled: boolean,
): TimelineItem[] {
  return linkedSelectionEnabled ? getLinkedItems(items, itemId) : getAnchorItem(items, itemId)
}

export function getSynchronizedLinkedItemsForEdit(
  items: TimelineItem[],
  itemId: string,
  linkedSelectionEnabled: boolean,
): TimelineItem[] {
  return linkedSelectionEnabled
    ? getSynchronizedLinkedItems(items, itemId)
    : getAnchorItem(items, itemId)
}

export function getSynchronizedLinkedCounterpartPairForEdit(
  items: TimelineItem[],
  leftId: string,
  rightId: string,
  linkedSelectionEnabled: boolean,
): { leftCounterpart: TimelineItem; rightCounterpart: TimelineItem } | null {
  if (!linkedSelectionEnabled) {
    return null
  }

  return getSynchronizedLinkedCounterpartPair(items, leftId, rightId)
}

export function getMatchingSynchronizedLinkedCounterpartForEdit(
  items: TimelineItem[],
  itemId: string,
  trackId: string,
  type: TimelineItem['type'],
  linkedSelectionEnabled: boolean,
): TimelineItem | null {
  if (!linkedSelectionEnabled) {
    return null
  }

  return getMatchingSynchronizedLinkedCounterpart(items, itemId, trackId, type)
}

export function buildLinkedLeftShiftUpdates(
  items: TimelineItem[],
  baseShiftByItemId: ReadonlyMap<string, number>,
  linkedSelectionEnabled: boolean,
): Array<{ id: string; from: number }> {
  if (!linkedSelectionEnabled) {
    const shiftByItemId = new Map(baseShiftByItemId)
    for (const [itemId, shiftAmount] of baseShiftByItemId) {
      if (shiftAmount <= 0) continue
      for (const attachedId of expandItemIdsWithAttachedCaptions(items, [itemId])) {
        shiftByItemId.set(attachedId, Math.max(shiftByItemId.get(attachedId) ?? 0, shiftAmount))
      }
    }

    return items.flatMap((item) => {
      const shiftAmount = shiftByItemId.get(item.id) ?? 0
      return shiftAmount > 0 ? [{ id: item.id, from: item.from - shiftAmount }] : []
    })
  }

  const shiftByItemId = new Map(baseShiftByItemId)
  const visited = new Set<string>()

  for (const item of items) {
    if (visited.has(item.id)) continue

    const linkedItems = getLinkedItems(items, item.id)
    for (const linkedItem of linkedItems) {
      visited.add(linkedItem.id)
    }

    if (linkedItems.length <= 1) continue

    let groupShift = 0
    for (const linkedItem of linkedItems) {
      groupShift = Math.max(groupShift, baseShiftByItemId.get(linkedItem.id) ?? 0)
    }

    if (groupShift <= 0) continue

    for (const linkedItem of linkedItems) {
      shiftByItemId.set(linkedItem.id, groupShift)
    }
  }

  for (const [itemId, shiftAmount] of shiftByItemId) {
    if (shiftAmount <= 0) continue
    for (const attachedId of expandItemIdsWithAttachedCaptions(items, [itemId])) {
      shiftByItemId.set(attachedId, Math.max(shiftByItemId.get(attachedId) ?? 0, shiftAmount))
    }
  }

  return items.flatMap((item) => {
    const shiftAmount = shiftByItemId.get(item.id) ?? 0
    return shiftAmount > 0 ? [{ id: item.id, from: item.from - shiftAmount }] : []
  })
}

export function buildSynchronizedLinkedMoveUpdatesForEdit(
  items: TimelineItem[],
  baseDeltaByItemId: ReadonlyMap<string, number>,
  linkedSelectionEnabled: boolean,
): Array<{ id: string; from: number }> {
  if (!linkedSelectionEnabled) {
    return items.flatMap((item) => {
      const delta = baseDeltaByItemId.get(item.id) ?? 0
      return delta !== 0 ? [{ id: item.id, from: item.from + delta }] : []
    })
  }

  return buildSynchronizedLinkedMoveUpdates(items, baseDeltaByItemId)
}
