import { useRef } from 'react'
import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/preview/deps/timeline-store'

export interface TransformStableItemsSnapshot {
  items: TimelineItem[]
  itemsByTrackId: Record<string, TimelineItem[]>
}

type ItemsSnapshotState = TransformStableItemsSnapshot

function hasOnlyTransformFieldChanged(previous: TimelineItem, next: TimelineItem): boolean {
  if (previous === next) return true
  if (previous.id !== next.id || previous.type !== next.type) return false

  // A mask's transform participates in the composition-wide mask plan rather
  // than an item-local wrapper, so it must keep taking the full snapshot path.
  if ((previous.type === 'shape' && previous.isMask) || (next.type === 'shape' && next.isMask)) {
    return false
  }

  const previousRecord = previous as unknown as Record<string, unknown>
  const nextRecord = next as unknown as Record<string, unknown>
  const previousKeys = Object.keys(previousRecord)
  const nextKeys = Object.keys(nextRecord)

  if (previousKeys.length !== nextKeys.length) return false

  for (const key of previousKeys) {
    if (!(key in nextRecord)) return false
    if (key !== 'transform' && !Object.is(previousRecord[key], nextRecord[key])) {
      return false
    }
  }

  return true
}

export function canRetainSnapshotForTransformChanges(
  previous: readonly TimelineItem[],
  next: readonly TimelineItem[],
): boolean {
  if (previous === next) return true
  if (previous.length !== next.length) return false

  for (let index = 0; index < previous.length; index += 1) {
    const previousItem = previous[index]
    const nextItem = next[index]
    if (!previousItem || !nextItem || !hasOnlyTransformFieldChanged(previousItem, nextItem)) {
      return false
    }
  }

  return true
}

export function createTransformStableItemsSelector(): (
  state: ItemsSnapshotState,
) => TransformStableItemsSnapshot {
  let lastObservedItems: TimelineItem[] | null = null
  let retainedSnapshot: TransformStableItemsSnapshot | null = null

  return (state) => {
    if (!retainedSnapshot || !lastObservedItems) {
      lastObservedItems = state.items
      retainedSnapshot = {
        items: state.items,
        itemsByTrackId: state.itemsByTrackId,
      }
      return retainedSnapshot
    }

    if (state.items === lastObservedItems) {
      return retainedSnapshot
    }

    const canRetain = canRetainSnapshotForTransformChanges(lastObservedItems, state.items)
    lastObservedItems = state.items

    if (canRetain) {
      return retainedSnapshot
    }

    retainedSnapshot = {
      items: state.items,
      itemsByTrackId: state.itemsByTrackId,
    }
    return retainedSnapshot
  }
}

/**
 * Keeps composition-wide preview data stable for ordinary item transforms.
 *
 * Item wrappers read the latest transform through the preview-only live
 * transform source. Any edit that affects topology, timing, masks, media, or
 * other item properties still returns a fresh snapshot synchronously.
 */
export function useTransformStableItemsSnapshot(): TransformStableItemsSnapshot {
  const selectorRef = useRef<ReturnType<typeof createTransformStableItemsSelector> | null>(null)
  if (selectorRef.current === null) {
    selectorRef.current = createTransformStableItemsSelector()
  }
  return useItemsStore(selectorRef.current)
}
