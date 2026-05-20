import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { execute, applyTransitionRepairs } from '../shared'
import { expandIdsWithLinkedItems, getLinkedItemsForEdit } from '../linked-edit'
import {
  sourceSecondsToTimelineFrame,
  getItemSourceSpanSeconds,
} from '../../../utils/media-item-frames'
import { getUniqueLinkedItemAnchorIds } from '../../../utils/linked-items'
import { isTrackSyncLockEnabled } from '../../../utils/track-sync-lock'
import { propagateRemovedIntervalsToSyncLockedTracks } from '../sync-lock-ripple'
import { applySplitBookkeeping, type SplitResultEntry } from '../split-bookkeeping'
import {
  isLinkedSelectionEnabled,
  isInTransitionOverlap,
  requestPostEditWarmForItems,
} from './shared'

export interface RemoveSilenceRange {
  start: number
  end: number
}

export interface RemoveSilenceResult {
  analyzedItemCount: number
  removedItemCount: number
  splitCount: number
}

// A post-split segment is removed when at least this fraction of its source-time
// span is covered by detected silence. The threshold guards two cases:
//   1. Frames that couldn't be split cleanly (e.g. inside a transition overlap)
//      leave a partial segment whose start/end still bracket loud audio — we
//      keep those so users don't lose speech to the silence cutter.
//   2. Floating-point rounding when converting source seconds → timeline frames
//      can leave a few frames of audible content on either side of a "fully
//      silent" segment — 0.75 is permissive enough to remove those anyway.
const SILENCE_COVERAGE_REMOVAL_THRESHOLD = 0.75

function isMostlyInsideRanges(
  span: { start: number; end: number },
  ranges: readonly RemoveSilenceRange[],
): boolean {
  const duration = span.end - span.start
  if (duration <= 0) return false

  const covered = ranges.reduce((sum, range) => {
    const overlapStart = Math.max(span.start, range.start)
    const overlapEnd = Math.min(span.end, range.end)
    return sum + Math.max(0, overlapEnd - overlapStart)
  }, 0)

  return covered / duration >= SILENCE_COVERAGE_REMOVAL_THRESHOLD
}

function applyRippleRemoval(ids: string[]): { removedIds: string[]; affectedIds: string[] } {
  const items = useItemsStore.getState().items
  const linkedSelectionEnabled = isLinkedSelectionEnabled()
  const expandedIds = expandIdsWithLinkedItems(items, ids, linkedSelectionEnabled)
  if (expandedIds.length === 0) return { removedIds: [], affectedIds: [] }

  const idsToDelete = new Set(expandedIds)
  const remainingItems = items.filter((item) => !idsToDelete.has(item.id))
  const baseShiftByItemId = new Map<string, number>()
  const editedTrackIds = new Set(
    items.filter((item) => idsToDelete.has(item.id)).map((item) => item.trackId),
  )
  const removedIntervals = items
    .filter((item) => idsToDelete.has(item.id))
    .map((item) => ({
      start: item.from,
      end: item.from + item.durationInFrames,
    }))

  for (const item of remainingItems) {
    const shiftAmount = items
      .filter((candidate) => idsToDelete.has(candidate.id))
      .filter(
        (deletedItem) =>
          deletedItem.trackId === item.trackId &&
          deletedItem.from + deletedItem.durationInFrames <= item.from,
      )
      .reduce((sum, deletedItem) => sum + deletedItem.durationInFrames, 0)

    if (shiftAmount > 0) {
      baseShiftByItemId.set(item.id, shiftAmount)
    }
  }

  const trackById = new Map(useItemsStore.getState().tracks.map((track) => [track.id, track]))
  const itemById = new Map(remainingItems.map((item) => [item.id, item]))
  const shiftByItemId = new Map<string, number>()

  for (const [itemId, shiftAmount] of baseShiftByItemId) {
    if (shiftAmount <= 0) continue

    const relatedIds = expandIdsWithLinkedItems(remainingItems, [itemId], linkedSelectionEnabled)
    for (const relatedId of relatedIds) {
      const relatedItem = itemById.get(relatedId)
      if (!relatedItem) continue

      const handledBySyncLock =
        !editedTrackIds.has(relatedItem.trackId) &&
        isTrackSyncLockEnabled(trackById.get(relatedItem.trackId))
      if (handledBySyncLock) continue

      shiftByItemId.set(relatedId, Math.max(shiftByItemId.get(relatedId) ?? 0, shiftAmount))
    }
  }

  const updates = remainingItems.flatMap((item) => {
    const shiftAmount = shiftByItemId.get(item.id) ?? 0
    return shiftAmount > 0 ? [{ id: item.id, from: item.from - shiftAmount }] : []
  })

  const shiftedById = new Map(updates.map((update) => [update.id, update.from]))
  const coveredIds: string[] = []
  for (const item of remainingItems) {
    if (shiftedById.has(item.id)) continue
    const itemEnd = item.from + item.durationInFrames
    for (const other of remainingItems) {
      const newFrom = shiftedById.get(other.id)
      if (newFrom === undefined || other.trackId !== item.trackId) continue
      const newEnd = newFrom + other.durationInFrames
      if (newFrom < itemEnd && newEnd > item.from) {
        coveredIds.push(item.id)
        break
      }
    }
  }

  const expandedCoveredIds = expandIdsWithLinkedItems(
    remainingItems,
    coveredIds,
    linkedSelectionEnabled,
  )
  const allRemoveIds = [...expandedIds, ...expandedCoveredIds]
  const coveredSet = new Set(expandedCoveredIds)
  const filteredUpdates =
    coveredSet.size > 0 ? updates.filter((update) => !coveredSet.has(update.id)) : updates

  const store = useItemsStore.getState()
  store._removeItems(allRemoveIds)
  if (filteredUpdates.length > 0) {
    store._moveItems(filteredUpdates)
  }

  const syncLockResult = propagateRemovedIntervalsToSyncLockedTracks({
    editedTrackIds,
    intervals: removedIntervals,
  })

  const cascadedRemoveIds = Array.from(new Set([...allRemoveIds, ...syncLockResult.removedIds]))
  useTransitionsStore.getState()._removeTransitionsForItems(cascadedRemoveIds)
  useKeyframesStore.getState()._removeKeyframesForItems(cascadedRemoveIds)

  if (filteredUpdates.length > 0) {
    applyTransitionRepairs(filteredUpdates.map((update) => update.id))
  }

  const repairedClipIds = Array.from(
    new Set([...updates.map((update) => update.id), ...syncLockResult.affectedIds]),
  )
  if (repairedClipIds.length > 0) {
    applyTransitionRepairs(repairedClipIds, new Set(cascadedRemoveIds))
  }

  return {
    removedIds: cascadedRemoveIds,
    affectedIds: Array.from(new Set([...repairedClipIds, ...filteredUpdates.map((u) => u.id)])),
  }
}

export function removeSilenceFromItems(
  itemIds: string[],
  silenceRangesByMediaId: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  return removeTimelineRangesFromItems('REMOVE_SILENCE', itemIds, silenceRangesByMediaId)
}

export function removeFillerWordsFromItems(
  itemIds: string[],
  fillerRangesByMediaId: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  return removeTimelineRangesFromItems('REMOVE_FILLER_WORDS', itemIds, fillerRangesByMediaId)
}

function removeTimelineRangesFromItems(
  commandType: 'REMOVE_SILENCE' | 'REMOVE_FILLER_WORDS',
  itemIds: string[],
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  if (itemIds.length === 0) {
    return { analyzedItemCount: 0, removedItemCount: 0, splitCount: 0 }
  }

  return execute(
    commandType,
    () => {
      const timelineFps = useTimelineSettingsStore.getState().fps
      const initialItems = useItemsStore.getState().items
      const anchorIds = getUniqueLinkedItemAnchorIds(initialItems, itemIds)
      const anchors = anchorIds
        .map((id) => initialItems.find((item) => item.id === id))
        .filter(
          (item): item is TimelineItem =>
            item !== undefined &&
            (item.type === 'video' || item.type === 'audio') &&
            !!item.mediaId &&
            (rangesByMediaId[item.mediaId]?.length ?? 0) > 0,
        )

      if (anchors.length === 0) {
        return { analyzedItemCount: 0, removedItemCount: 0, splitCount: 0 }
      }

      const anchorDescriptors = anchors.map((item) => ({
        id: item.id,
        mediaId: item.mediaId!,
        originId: item.originId ?? item.id,
      }))

      let splitCount = 0
      for (const anchor of anchors) {
        const ranges = rangesByMediaId[anchor.mediaId!]
        if (!ranges || ranges.length === 0) continue

        const splitFrames = Array.from(
          new Set(
            ranges.flatMap((range) => [
              sourceSecondsToTimelineFrame(anchor, range.start, timelineFps),
              sourceSecondsToTimelineFrame(anchor, range.end, timelineFps),
            ]),
          ),
        )
          .filter((frame) => frame > anchor.from && frame < anchor.from + anchor.durationInFrames)
          .sort((left, right) => right - left)

        if (splitFrames.length === 0) continue

        const itemsToSplit = getLinkedItemsForEdit(
          useItemsStore.getState().items,
          anchor.id,
          isLinkedSelectionEnabled(),
        )
        if (itemsToSplit.length === 0) continue

        for (const frame of splitFrames) {
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
            return !isInTransitionOverlap(
              currentItem.id,
              relativeFrame,
              currentItem.durationInFrames,
            )
          })

          if (!canSplitFrame) continue

          const frameSplitResults = itemsToSplit
            .map((item) => ({
              originalId: item.id,
              originalLinkedGroupId: item.linkedGroupId,
              result: useItemsStore.getState()._splitItem(item.id, frame),
            }))
            .filter((entry): entry is SplitResultEntry => entry.result !== null)

          if (frameSplitResults.length !== itemsToSplit.length) continue

          applySplitBookkeeping(frameSplitResults)
          splitCount += 1

          for (const entry of frameSplitResults) {
            applyTransitionRepairs([entry.result.leftItem.id, entry.result.rightItem.id])
          }
        }
      }

      const currentItems = useItemsStore.getState().items
      const idsToRemove = new Set<string>()

      for (const descriptor of anchorDescriptors) {
        const ranges = rangesByMediaId[descriptor.mediaId]
        if (!ranges || ranges.length === 0) continue

        for (const candidate of currentItems) {
          if (candidate.type !== 'video' && candidate.type !== 'audio') continue
          if (candidate.mediaId !== descriptor.mediaId) continue
          if ((candidate.originId ?? candidate.id) !== descriptor.originId) continue

          const span = getItemSourceSpanSeconds(candidate, timelineFps)
          if (span !== null && isMostlyInsideRanges(span, ranges)) {
            idsToRemove.add(candidate.id)
          }
        }
      }

      if (idsToRemove.size === 0) {
        return { analyzedItemCount: anchors.length, removedItemCount: 0, splitCount }
      }

      const removalResult = applyRippleRemoval(Array.from(idsToRemove))
      const affectedIds = Array.from(new Set([...idsToRemove, ...removalResult.affectedIds]))
      requestPostEditWarmForItems(affectedIds)
      useTimelineSettingsStore.getState().markDirty()

      return {
        analyzedItemCount: anchors.length,
        removedItemCount: removalResult.removedIds.length,
        splitCount,
      }
    },
    { itemIds, mediaCount: Object.keys(rangesByMediaId).length },
  )
}
