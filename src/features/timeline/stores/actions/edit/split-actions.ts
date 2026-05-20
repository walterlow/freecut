import type { TimelineItem } from '@/types/timeline'
import { toast } from 'sonner'
import { useItemsStore } from '../../items-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { useSelectionStore } from '@/shared/state/selection'
import { execute, applyTransitionRepairs } from '../shared'
import { getLinkedItemsForEdit } from '../linked-edit'
import { getUniqueLinkedItemAnchorIds } from '../../../utils/linked-items'
import { applySplitBookkeeping, type SplitResultEntry } from '../split-bookkeeping'
import { isLinkedSelectionEnabled, isInTransitionOverlap } from './shared'

export function splitItem(
  id: string,
  splitFrame: number,
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
  const items = useItemsStore.getState().items
  const itemsToSplit = getLinkedItemsForEdit(items, id, isLinkedSelectionEnabled())

  for (const item of itemsToSplit) {
    // Bounds check first — out-of-range splits are a silent no-op (handled by _splitItem),
    // must not fall through to transition zone check which would false-positive.
    if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
      return null
    }
    const relativeFrame = splitFrame - item.from
    if (isInTransitionOverlap(item.id, relativeFrame, item.durationInFrames)) {
      toast.warning('Cannot split inside a transition zone')
      return null
    }
  }

  return execute(
    'SPLIT_ITEM',
    () => {
      const itemsStore = useItemsStore.getState()
      const splitResults = itemsToSplit
        .map((item) => ({
          originalId: item.id,
          originalLinkedGroupId: item.linkedGroupId,
          result: itemsStore._splitItem(item.id, splitFrame),
        }))
        .filter((entry): entry is SplitResultEntry => entry.result !== null)

      const anchorResult = splitResults.find((entry) => entry.originalId === id)?.result ?? null
      if (!anchorResult) return null

      applySplitBookkeeping(splitResults)

      // Keep selection anchored to the split clip for immediate downstream
      // adjacency/transition detection across all split entry points.
      useSelectionStore
        .getState()
        .selectItems(splitResults.map((entry) => entry.result.leftItem.id))

      useTimelineSettingsStore.getState().markDirty()
      return anchorResult
    },
    { id, splitFrame },
  )
}

/**
 * Split every item crossing a timeline frame in a single undo operation.
 * Used by playhead-based "split across all tracks" shortcuts.
 */
export function splitAllItemsAtFrame(splitFrame: number): number {
  const items = useItemsStore.getState().items
  const overlappingItemIds = items
    .filter((item) => splitFrame > item.from && splitFrame < item.from + item.durationInFrames)
    .map((item) => item.id)
  const anchorIds = getUniqueLinkedItemAnchorIds(items, overlappingItemIds)

  if (anchorIds.length === 0) return 0

  let splitCount = 0

  execute(
    'SPLIT_ALL_ITEMS_AT_FRAME',
    () => {
      for (const anchorId of anchorIds) {
        const currentItems = useItemsStore.getState().items
        const itemsToSplit = getLinkedItemsForEdit(
          currentItems,
          anchorId,
          isLinkedSelectionEnabled(),
        )
        if (itemsToSplit.length === 0) continue

        let blockedByTransition = false
        const canSplitGroup = itemsToSplit.every((item) => {
          if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
            return false
          }

          const relativeFrame = splitFrame - item.from
          if (isInTransitionOverlap(item.id, relativeFrame, item.durationInFrames)) {
            blockedByTransition = true
            return false
          }

          return true
        })

        if (!canSplitGroup) {
          if (blockedByTransition) {
            toast.warning('Cannot split inside a transition zone')
          }
          continue
        }

        const splitResults = itemsToSplit
          .map((item) => ({
            originalId: item.id,
            originalLinkedGroupId: item.linkedGroupId,
            result: useItemsStore.getState()._splitItem(item.id, splitFrame),
          }))
          .filter((entry): entry is SplitResultEntry => entry.result !== null)

        const anchorResult =
          splitResults.find((entry) => entry.originalId === anchorId)?.result ?? null
        if (!anchorResult) continue

        applySplitBookkeeping(splitResults)
        useSelectionStore
          .getState()
          .selectItems(splitResults.map((entry) => entry.result.leftItem.id))
        splitCount += 1
      }

      if (splitCount > 0) {
        useTimelineSettingsStore.getState().markDirty()
      }
    },
    { ids: anchorIds, splitFrame },
  )

  return splitCount
}

/**
 * Split a clip at multiple frames in one undo operation.
 * Frames must be in absolute timeline space.
 * Splits from last to first so the original item ID stays valid.
 * Clears fadeIn/fadeOut on inner cuts so only the outermost edges keep fades.
 */
export function splitItemAtFrames(id: string, splitFrames: number[]): number {
  if (splitFrames.length === 0) return 0

  const sorted = [...splitFrames].sort((a, b) => b - a)
  let splitCount = 0

  execute(
    'SPLIT_ITEM_MULTI',
    () => {
      const itemsToSplit = getLinkedItemsForEdit(
        useItemsStore.getState().items,
        id,
        isLinkedSelectionEnabled(),
      )
      if (itemsToSplit.length === 0) return

      const rightIdsByOriginalId = new Map(itemsToSplit.map((item) => [item.id, [] as string[]]))

      for (const frame of sorted) {
        const currentItemsById = useItemsStore.getState().itemById
        const canSplitFrame = itemsToSplit.every((item) => {
          const currentItem = currentItemsById[item.id]
          if (!currentItem) return false
          if (
            frame <= currentItem.from ||
            frame >= currentItem.from + currentItem.durationInFrames
          ) {
            return false
          }

          const relativeFrame = frame - currentItem.from
          return !isInTransitionOverlap(currentItem.id, relativeFrame, currentItem.durationInFrames)
        })

        if (!canSplitFrame) {
          continue
        }

        // Preflight: verify all items still exist and are splittable before mutating
        const store = useItemsStore.getState()
        const allSplittable = itemsToSplit.every((item) => {
          const current = store.itemById[item.id]
          return current && frame > current.from && frame < current.from + current.durationInFrames
        })
        if (!allSplittable) continue

        const frameSplitResults = itemsToSplit
          .map((item) => ({
            originalId: item.id,
            originalLinkedGroupId: item.linkedGroupId,
            result: useItemsStore.getState()._splitItem(item.id, frame),
          }))
          .filter((entry): entry is SplitResultEntry => entry.result !== null)

        if (frameSplitResults.length !== itemsToSplit.length) {
          continue
        }

        applySplitBookkeeping(frameSplitResults)

        splitCount++

        for (const entry of frameSplitResults) {
          rightIdsByOriginalId.get(entry.originalId)?.push(entry.result.rightItem.id)
          applyTransitionRepairs([entry.result.leftItem.id, entry.result.rightItem.id])
        }
      }

      // Clear fades on inner split edges:
      // - Every right piece gets fadeIn cleared (it's an inner cut, not the clip's original start)
      // - Every right piece except the last (outermost) gets fadeOut cleared
      // - The left piece (original ID) gets fadeOut cleared (its right edge is an inner cut)
      if (splitCount > 0) {
        for (const [originalId, rightIds] of rightIdsByOriginalId) {
          for (const rightId of rightIds) {
            useItemsStore.getState()._updateItem(rightId, { fadeIn: 0 })
          }
          // Clear fadeOut on all right pieces except the very last one (which has the original clip's end)
          for (let index = 1; index < rightIds.length; index += 1) {
            useItemsStore.getState()._updateItem(rightIds[index]!, { fadeOut: 0 })
          }
          // Clear fadeOut on the left piece (original ID) — its right edge is now an inner cut
          useItemsStore.getState()._updateItem(originalId, { fadeOut: 0 })
        }
      }

      useTimelineSettingsStore.getState().markDirty()
    },
    { id, splitFrames: sorted },
  )

  return splitCount
}
