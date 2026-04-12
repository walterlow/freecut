/**
 * Item edit actions split from item-actions.ts to keep the main entry point smaller.
 */

import type { TimelineItem, ImageItem } from '@/types/timeline';
import type { MediaMetadata, ThumbnailData } from '@/types/storage';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useEditorStore } from '@/shared/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import {
  mediaLibraryService,
  opfsService,
} from '@/features/timeline/deps/media-library-service';
import { toast } from 'sonner';
import { execute, applyTransitionRepairs, getLogger } from './shared';
import {
  getLinkedItemsForEdit,
  getMatchingSynchronizedLinkedCounterpartForEdit,
  getSynchronizedLinkedCounterpartPairForEdit,
  getSynchronizedLinkedItemsForEdit,
} from './linked-edit';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { timelineToSourceFrames, sourceToTimelineFrames } from '../../utils/source-calculations';
import { computeClampedSlipDelta } from '../../utils/slip-utils';
import { computeSlideContinuitySourceDelta } from '../../utils/slide-utils';
import { clampSlideDeltaToPreserveTransitions } from '../../utils/transition-utils';
import { calculateTransitionPortions } from '@/domain/timeline/transitions/transition-planner';
import { getLinkedItemIds } from '../../utils/linked-items';
import {
  propagateInsertedGapToSyncLockedTracks,
  propagateRemovedIntervalsToSyncLockedTracks,
} from './sync-lock-ripple';
import { applySplitBookkeeping, type SplitResultEntry } from './split-bookkeeping';

function isLinkedSelectionEnabled(): boolean {
  return useEditorStore.getState().linkedSelectionEnabled;
}

function applySynchronizedTrim(id: string, handle: 'start' | 'end', trimAmount: number): void {
  const itemsStore = useItemsStore.getState();
  const itemsBefore = itemsStore.items;
  const synchronizedItems = getSynchronizedLinkedItemsForEdit(itemsBefore, id, isLinkedSelectionEnabled());
  const anchorBefore = synchronizedItems.find((item) => item.id === id);
  if (!anchorBefore) return;

  if (handle === 'start') {
    itemsStore._trimItemStart(id, trimAmount);
  } else {
    itemsStore._trimItemEnd(id, trimAmount);
  }

  const anchorAfter = useItemsStore.getState().itemById[id];
  const actualTrimAmount = handle === 'start'
    ? anchorAfter ? anchorAfter.from - anchorBefore.from : 0
    : anchorAfter ? anchorAfter.durationInFrames - anchorBefore.durationInFrames : 0;

  if (actualTrimAmount !== 0) {
    for (const synchronizedItem of synchronizedItems) {
      if (synchronizedItem.id === id) continue;

      if (handle === 'start') {
        itemsStore._trimItemStart(synchronizedItem.id, actualTrimAmount, { skipAdjacentClamp: true });
      } else {
        itemsStore._trimItemEnd(synchronizedItem.id, actualTrimAmount, { skipAdjacentClamp: true });
      }
    }
  }

  applyTransitionRepairs(synchronizedItems.map((item) => item.id));
  useTimelineSettingsStore.getState().markDirty();
}

export function trimItemStart(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_START', () => {
    applySynchronizedTrim(id, 'start', trimAmount);
  }, { id, trimAmount });
}

export function trimItemEnd(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_END', () => {
    applySynchronizedTrim(id, 'end', trimAmount);
  }, { id, trimAmount });
}

export function trimItemBreakingTransition(
  id: string,
  handle: 'start' | 'end',
  trimAmount: number,
  transitionIdsToRemove: string[],
): void {
  execute(handle === 'start' ? 'TRIM_ITEM_START' : 'TRIM_ITEM_END', () => {
    if (transitionIdsToRemove.length > 0) {
      useTransitionsStore.getState()._removeTransitions(transitionIdsToRemove);
    }

    applySynchronizedTrim(id, handle, trimAmount);
  }, {
    id,
    handle,
    trimAmount,
    removedTransitionCount: transitionIdsToRemove.length,
  });
}

/**
 * Check if a frame falls inside any transition bridge zone for a given item.
 * Uses cut-centered consumed portions so splits are only blocked on the actual
 * frames participating in the transition for that clip.
 */
function isInTransitionOverlap(itemId: string, relativeFrame: number, itemDuration: number): boolean {
  const transitions = useTransitionsStore.getState().transitions;
  return transitions.some((transition) => {
    const portions = calculateTransitionPortions(transition.durationInFrames, transition.alignment);
    return (
      (transition.leftClipId === itemId && relativeFrame >= itemDuration - portions.leftPortion)
      || (transition.rightClipId === itemId && relativeFrame < portions.rightPortion)
    );
  });
}

export function splitItem(
  id: string,
  splitFrame: number
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
  const items = useItemsStore.getState().items;
  const itemsToSplit = getLinkedItemsForEdit(items, id, isLinkedSelectionEnabled());

  for (const item of itemsToSplit) {
    // Bounds check first — out-of-range splits are a silent no-op (handled by _splitItem),
    // must not fall through to transition zone check which would false-positive.
    if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
      return null;
    }
    const relativeFrame = splitFrame - item.from;
    if (isInTransitionOverlap(item.id, relativeFrame, item.durationInFrames)) {
      toast.warning('Cannot split inside a transition zone');
      return null;
    }
  }

  return execute('SPLIT_ITEM', () => {
    const itemsStore = useItemsStore.getState();
    const splitResults = itemsToSplit
      .map((item) => ({
        originalId: item.id,
        originalLinkedGroupId: item.linkedGroupId,
        result: itemsStore._splitItem(item.id, splitFrame),
      }))
      .filter((entry): entry is SplitResultEntry => entry.result !== null);

    const anchorResult = splitResults.find((entry) => entry.originalId === id)?.result ?? null;
    if (!anchorResult) return null;

    applySplitBookkeeping(splitResults);

    // Keep selection anchored to the split clip for immediate downstream
    // adjacency/transition detection across all split entry points.
    useSelectionStore.getState().selectItems(splitResults.map((entry) => entry.result.leftItem.id));

    useTimelineSettingsStore.getState().markDirty();
    return anchorResult;
  }, { id, splitFrame });
}

/**
 * Split a clip at multiple frames in one undo operation.
 * Frames must be in absolute timeline space.
 * Splits from last to first so the original item ID stays valid.
 * Clears fadeIn/fadeOut on inner cuts so only the outermost edges keep fades.
 */
export function splitItemAtFrames(
  id: string,
  splitFrames: number[],
): number {
  if (splitFrames.length === 0) return 0;

  const sorted = [...splitFrames].sort((a, b) => b - a);
  let splitCount = 0;

  execute('SPLIT_ITEM_MULTI', () => {
    const itemsToSplit = getLinkedItemsForEdit(
      useItemsStore.getState().items,
      id,
      isLinkedSelectionEnabled(),
    );
    if (itemsToSplit.length === 0) return;

    const rightIdsByOriginalId = new Map(itemsToSplit.map((item) => [item.id, [] as string[]]));

    for (const frame of sorted) {
      const currentItemsById = useItemsStore.getState().itemById;
      const canSplitFrame = itemsToSplit.every((item) => {
        const currentItem = currentItemsById[item.id];
        if (!currentItem) return false;
        if (frame <= currentItem.from || frame >= currentItem.from + currentItem.durationInFrames) {
          return false;
        }

        const relativeFrame = frame - currentItem.from;
        return !isInTransitionOverlap(currentItem.id, relativeFrame, currentItem.durationInFrames);
      });

      if (!canSplitFrame) {
        continue;
      }

      // Preflight: verify all items still exist and are splittable before mutating
      const store = useItemsStore.getState();
      const allSplittable = itemsToSplit.every((item) => {
        const current = store.itemById[item.id];
        return current && frame > current.from && frame < current.from + current.durationInFrames;
      });
      if (!allSplittable) continue;

      const frameSplitResults = itemsToSplit
        .map((item) => ({
          originalId: item.id,
          originalLinkedGroupId: item.linkedGroupId,
          result: useItemsStore.getState()._splitItem(item.id, frame),
        }))
        .filter((entry): entry is SplitResultEntry => entry.result !== null);

      if (frameSplitResults.length !== itemsToSplit.length) {
        continue;
      }

      applySplitBookkeeping(frameSplitResults);

      splitCount++;

      for (const entry of frameSplitResults) {
        rightIdsByOriginalId.get(entry.originalId)?.push(entry.result.rightItem.id);
        applyTransitionRepairs([entry.result.leftItem.id, entry.result.rightItem.id]);
      }
    }

    // Clear fades on inner split edges:
    // - Every right piece gets fadeIn cleared (it's an inner cut, not the clip's original start)
    // - Every right piece except the last (outermost) gets fadeOut cleared
    // - The left piece (original ID) gets fadeOut cleared (its right edge is an inner cut)
    if (splitCount > 0) {
      for (const [originalId, rightIds] of rightIdsByOriginalId) {
        for (const rightId of rightIds) {
          useItemsStore.getState()._updateItem(rightId, { fadeIn: 0 });
        }
        // Clear fadeOut on all right pieces except the very last one (which has the original clip's end)
        for (let index = 1; index < rightIds.length; index += 1) {
          useItemsStore.getState()._updateItem(rightIds[index]!, { fadeOut: 0 });
        }
        // Clear fadeOut on the left piece (original ID) — its right edge is now an inner cut
        useItemsStore.getState()._updateItem(originalId, { fadeOut: 0 });
      }
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, splitFrames: sorted });

  return splitCount;
}

export function joinItems(itemIds: string[]): void {
  execute('JOIN_ITEMS', () => {
    const items = useItemsStore.getState().items;
    const itemsToJoin = items
      .filter((item) => itemIds.includes(item.id))
      .toSorted((left, right) => left.from - right.from);
    if (itemsToJoin.length < 2) return;

    const joinGroups = [itemIds];
    if (itemsToJoin.length === 2) {
      const [leftItem, rightItem] = itemsToJoin;
      if (leftItem && rightItem) {
        const counterpartPair = getSynchronizedLinkedCounterpartPairForEdit(
          items,
          leftItem.id,
          rightItem.id,
          isLinkedSelectionEnabled(),
        );
        if (counterpartPair) {
          joinGroups.push([counterpartPair.leftCounterpart.id, counterpartPair.rightCounterpart.id]);
        }
      }
    }

    const groupDescriptors = joinGroups
      .map((groupItemIds) => items
        .filter((item) => groupItemIds.includes(item.id))
        .toSorted((left, right) => left.from - right.from))
      .filter((groupItems) => groupItems.length >= 2)
      .map((groupItems) => ({
        itemIds: groupItems.map((item) => item.id),
        primaryId: groupItems[0]!.id,
        removedIds: groupItems.slice(1).map((item) => item.id),
      }));

    for (const group of groupDescriptors) {
      useItemsStore.getState()._joinItems(group.itemIds);
    }

    const replacementByRemovedId = new Map<string, string>();
    for (const group of groupDescriptors) {
      for (const removedId of group.removedIds) {
        replacementByRemovedId.set(removedId, group.primaryId);
      }
    }

    if (replacementByRemovedId.size > 0) {
      const transitions = useTransitionsStore.getState().transitions;
      const updatedTransitions = transitions.flatMap((transition) => {
        const nextTransition = {
          ...transition,
          leftClipId: replacementByRemovedId.get(transition.leftClipId) ?? transition.leftClipId,
          rightClipId: replacementByRemovedId.get(transition.rightClipId) ?? transition.rightClipId,
        };

        if (nextTransition.leftClipId === nextTransition.rightClipId) {
          return [];
        }

        return [nextTransition];
      });

      useTransitionsStore.getState().setTransitions(updatedTransitions);
      applyTransitionRepairs(groupDescriptors.map((group) => group.primaryId));
    }

    const removedIds = groupDescriptors.flatMap((group) => group.removedIds);
    if (removedIds.length > 0) {
      useKeyframesStore.getState()._removeKeyframesForItems(removedIds);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { itemIds });
}

export function rateStretchItem(
  id: string,
  newFrom: number,
  newDuration: number,
  newSpeed: number
): void {
  execute('RATE_STRETCH_ITEM', () => {
    const itemsStore = useItemsStore.getState();
    const itemsBefore = itemsStore.items;
    const synchronizedItems = getSynchronizedLinkedItemsForEdit(itemsBefore, id, isLinkedSelectionEnabled());
    const anchorBefore = synchronizedItems.find((item) => item.id === id);
    if (!anchorBefore) return;

    // Capture old boundaries BEFORE stretch (needed for ripple + keyframe scaling)
    const oldDuration = anchorBefore.durationInFrames;
    const oldFrom = anchorBefore.from;
    const oldEnd = oldFrom + oldDuration;

    itemsStore._rateStretchItem(id, newFrom, newDuration, newSpeed);

    const anchorAfter = useItemsStore.getState().itemById[id];
    if (!anchorAfter) return;

    const actualFrom = anchorAfter.from;
    const actualDuration = anchorAfter.durationInFrames;
    const actualSpeed = anchorAfter.speed ?? newSpeed;
    const fromDelta = actualFrom - anchorBefore.from;

    for (const synchronizedItem of synchronizedItems) {
      if (synchronizedItem.id === id) continue;
      itemsStore._rateStretchItem(
        synchronizedItem.id,
        synchronizedItem.from + fromDelta,
        actualDuration,
        actualSpeed,
      );
    }

    // Scale keyframes proportionally to match new duration
    // This ensures animations maintain their relative timing within the clip
    if (oldDuration !== actualDuration) {
      for (const synchronizedItem of synchronizedItems) {
        useKeyframesStore.getState()._scaleKeyframesForItem(
          synchronizedItem.id,
          synchronizedItem.durationInFrames,
          actualDuration,
        );
      }
    }

    // Ripple phase: push/pull adjacent clips to maintain adjacency and prevent overlaps.
    // End handle: endDelta !== 0 → shift downstream clips.
    // Start handle: fromDelta !== 0, end stays fixed → shift upstream clips.
    const newEnd = actualFrom + actualDuration;
    const endDelta = newEnd - oldEnd;
    const allSynchronizedIds = new Set(synchronizedItems.map((si) => si.id));
    const freshItems = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;
    const movedIds = new Set<string>();
    const moveUpdates: Array<{ id: string; from: number }> = [];

    // Collect all track IDs touched by the stretched item + its linked companions
    const touchedTrackIds = new Set<string>();
    for (const si of synchronizedItems) {
      const freshSi = freshItems.find((i) => i.id === si.id);
      if (freshSi) touchedTrackIds.add(freshSi.trackId);
    }

    if (endDelta !== 0) {
      // End handle changed — shift downstream clips (at or past old end) on touched tracks
      for (const trackId of touchedTrackIds) {
        const downstreamItems = freshItems
          .filter((i) => i.trackId === trackId && !allSynchronizedIds.has(i.id) && i.from >= oldEnd)
          .sort((a, b) => a.from - b.from);

        for (const downstream of downstreamItems) {
          if (movedIds.has(downstream.id)) continue;
          movedIds.add(downstream.id);
          moveUpdates.push({ id: downstream.id, from: downstream.from + endDelta });

          // Also move linked companions on other tracks
          const linkedIds = getLinkedItemIds(freshItems, downstream.id);
          for (const linkedId of linkedIds) {
            if (linkedId === downstream.id || movedIds.has(linkedId)) continue;
            const linked = freshItems.find((i) => i.id === linkedId);
            if (linked) {
              movedIds.add(linkedId);
              moveUpdates.push({ id: linkedId, from: linked.from + endDelta });
            }
          }
        }
      }

      // Also shift transition-connected neighbors that aren't downstream by position
      // but are directly bridged to the stretched clip's end
      for (const si of synchronizedItems) {
        for (const t of transitions) {
          if (t.leftClipId === si.id && !allSynchronizedIds.has(t.rightClipId) && !movedIds.has(t.rightClipId)) {
            const neighbor = freshItems.find((i) => i.id === t.rightClipId);
            if (neighbor) {
              movedIds.add(neighbor.id);
              moveUpdates.push({ id: neighbor.id, from: neighbor.from + endDelta });
              const linkedIds = getLinkedItemIds(freshItems, neighbor.id);
              for (const linkedId of linkedIds) {
                if (linkedId === neighbor.id || movedIds.has(linkedId)) continue;
                const linked = freshItems.find((i) => i.id === linkedId);
                if (linked) {
                  movedIds.add(linkedId);
                  moveUpdates.push({ id: linkedId, from: linked.from + endDelta });
                }
              }
            }
          }
        }
      }
    }

    if (fromDelta !== 0) {
      // Start handle changed — shift upstream clips (ending at or before old from) on touched tracks
      for (const trackId of touchedTrackIds) {
        const upstreamItems = freshItems
          .filter((i) => {
            if (i.trackId !== trackId || allSynchronizedIds.has(i.id)) return false;
            const iEnd = i.from + i.durationInFrames;
            return iEnd <= oldFrom;
          })
          .sort((a, b) => a.from - b.from);

        for (const upstream of upstreamItems) {
          if (movedIds.has(upstream.id)) continue;
          movedIds.add(upstream.id);
          moveUpdates.push({ id: upstream.id, from: Math.max(0, upstream.from + fromDelta) });

          const linkedIds = getLinkedItemIds(freshItems, upstream.id);
          for (const linkedId of linkedIds) {
            if (linkedId === upstream.id || movedIds.has(linkedId)) continue;
            const linked = freshItems.find((i) => i.id === linkedId);
            if (linked) {
              movedIds.add(linkedId);
              moveUpdates.push({ id: linkedId, from: Math.max(0, linked.from + fromDelta) });
            }
          }
        }
      }

      // Also shift transition-connected neighbors bridged to the stretched clip's start
      for (const si of synchronizedItems) {
        for (const t of transitions) {
          if (t.rightClipId === si.id && !allSynchronizedIds.has(t.leftClipId) && !movedIds.has(t.leftClipId)) {
            const neighbor = freshItems.find((i) => i.id === t.leftClipId);
            if (neighbor) {
              movedIds.add(neighbor.id);
              moveUpdates.push({ id: neighbor.id, from: Math.max(0, neighbor.from + fromDelta) });
              const linkedIds = getLinkedItemIds(freshItems, neighbor.id);
              for (const linkedId of linkedIds) {
                if (linkedId === neighbor.id || movedIds.has(linkedId)) continue;
                const linked = freshItems.find((i) => i.id === linkedId);
                if (linked) {
                  movedIds.add(linkedId);
                  moveUpdates.push({ id: linkedId, from: Math.max(0, linked.from + fromDelta) });
                }
              }
            }
          }
        }
      }
    }

    if (moveUpdates.length > 0) {
      useItemsStore.getState()._moveItems(moveUpdates);
    }

    // Repair transitions for all affected clips
    const allAffectedIds = [...allSynchronizedIds, ...movedIds];
    applyTransitionRepairs(allAffectedIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, newFrom, newDuration, newSpeed });
}

/**
 * Reset speed to 1x for the given items and push subsequent clips right to
 * avoid overlaps. Everything happens in a single undo entry.
 *
 * When a variable-speed clip (e.g. 1.23x) is reset to 1x, it gets longer.
 * Without ripple, it would overlap the next clip on the same track. This
 * function shifts all downstream clips (and their linked companions) right
 * by the growth amount.
 */
export function resetSpeedWithRipple(itemIds: string[]): void {
  const TOLERANCE = 0.01;
  execute('RESET_SPEED_WITH_RIPPLE', () => {
    const itemsStore = useItemsStore.getState();
    const fps = useTimelineSettingsStore.getState().fps;

    // Collect all items that need resetting (deduplicate via synchronized links)
    const processedIds = new Set<string>();
    const stretchOps: Array<{
      id: string;
      trackId: string;
      oldEnd: number;
      newDuration: number;
      synchronizedIds: string[];
    }> = [];

    for (const id of itemIds) {
      if (processedIds.has(id)) continue;
      const item = itemsStore.items.find((i) => i.id === id);
      if (!item || (item.type !== 'video' && item.type !== 'audio')) continue;

      const currentSpeed = item.speed || 1;
      if (Math.abs(currentSpeed - 1) <= TOLERANCE) continue;

      const synchronizedItems = getSynchronizedLinkedItemsForEdit(itemsStore.items, id, isLinkedSelectionEnabled());
      for (const si of synchronizedItems) processedIds.add(si.id);

      const sourceFps = item.sourceFps ?? fps;
      const effectiveSourceFrames =
        item.sourceEnd !== undefined && item.sourceStart !== undefined
          ? item.sourceEnd - item.sourceStart
          : timelineToSourceFrames(item.durationInFrames, currentSpeed, fps, sourceFps);

      const newDuration = Math.max(1, sourceToTimelineFrames(effectiveSourceFrames, 1, sourceFps, fps));
      const oldEnd = item.from + item.durationInFrames;

      stretchOps.push({
        id,
        trackId: item.trackId,
        oldEnd,
        newDuration,
        synchronizedIds: synchronizedItems.map((si) => si.id),
      });
    }

    if (stretchOps.length === 0) return;

    // Phase 1: Apply all rate stretches
    for (const op of stretchOps) {
      const anchor = itemsStore.items.find((i) => i.id === op.id);
      if (!anchor) continue;

      const oldDuration = anchor.durationInFrames;
      itemsStore._rateStretchItem(op.id, anchor.from, op.newDuration, 1);

      // Synchronize linked items
      const anchorAfter = useItemsStore.getState().itemById[op.id];
      if (!anchorAfter) continue;

      const actualDuration = anchorAfter.durationInFrames;
      const fromDelta = anchorAfter.from - anchor.from;

      for (const siId of op.synchronizedIds) {
        if (siId === op.id) continue;
        const si = useItemsStore.getState().items.find((i) => i.id === siId);
        if (!si) continue;
        itemsStore._rateStretchItem(siId, si.from + fromDelta, actualDuration, anchorAfter.speed ?? 1);
      }

      // Scale keyframes
      if (oldDuration !== actualDuration) {
        for (const siId of op.synchronizedIds) {
          useKeyframesStore.getState()._scaleKeyframesForItem(siId, oldDuration, actualDuration);
        }
      }
    }

    // Phase 2: Push subsequent clips right to resolve overlaps
    const freshItems = useItemsStore.getState().items;
    const allChangedIds = new Set(stretchOps.flatMap((op) => op.synchronizedIds));
    const moveUpdates: Array<{ id: string; from: number }> = [];
    const movedIds = new Set<string>();

    for (const op of stretchOps) {
      const stretchedItem = freshItems.find((i) => i.id === op.id);
      if (!stretchedItem) continue;

      const newEnd = stretchedItem.from + stretchedItem.durationInFrames;
      const growth = newEnd - op.oldEnd;
      if (growth <= 0) continue;

      // Find all track IDs touched by this item + its linked companions
      const touchedTrackIds = new Set<string>();
      for (const siId of op.synchronizedIds) {
        const si = freshItems.find((i) => i.id === siId);
        if (si) touchedTrackIds.add(si.trackId);
      }

      // On each touched track, push subsequent clips right
      for (const trackId of touchedTrackIds) {
        const trackItems = freshItems
          .filter((i) => i.trackId === trackId && !allChangedIds.has(i.id) && i.from >= op.oldEnd)
          .sort((a, b) => a.from - b.from);

        for (const downstream of trackItems) {
          if (movedIds.has(downstream.id)) continue;
          movedIds.add(downstream.id);
          moveUpdates.push({ id: downstream.id, from: downstream.from + growth });

          // Also move linked companions on other tracks
          const linkedIds = getLinkedItemIds(freshItems, downstream.id);
          for (const linkedId of linkedIds) {
            if (linkedId === downstream.id || movedIds.has(linkedId)) continue;
            const linked = freshItems.find((i) => i.id === linkedId);
            if (linked) {
              movedIds.add(linkedId);
              moveUpdates.push({ id: linkedId, from: linked.from + growth });
            }
          }
        }
      }
    }

    if (moveUpdates.length > 0) {
      useItemsStore.getState()._moveItems(moveUpdates);
    }

    // Phase 3: Repair transitions for all affected clips
    const allAffectedIds = [...allChangedIds, ...movedIds];
    applyTransitionRepairs(allAffectedIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { itemIds });
}

/**
 * Insert a freeze frame at the playhead position.
 *
 * Extracts the video frame at the current playhead, stores it as a media entry,
 * splits the video clip at the playhead, and inserts a still image between the halves.
 *
 * This is async because frame extraction requires mediabunny. The timeline
 * mutations are batched in a single command for undo/redo atomicity.
 */
export async function insertFreezeFrame(
  itemId: string,
  playheadFrame: number
): Promise<boolean> {
  const items = useItemsStore.getState().items;
  const item = items.find((i) => i.id === itemId);
  if (!item || item.type !== 'video') return false;

  // Validate playhead is within item bounds (exclusive of edges — need room to split)
  const itemStart = item.from;
  const itemEnd = item.from + item.durationInFrames;
  if (playheadFrame <= itemStart || playheadFrame >= itemEnd) return false;

  // Block freeze frame insertion inside transition overlap zones
  if (isInTransitionOverlap(itemId, playheadFrame - itemStart, item.durationInFrames)) {
    return false;
  }

  const fps = useTimelineSettingsStore.getState().fps;
  const speed = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? 0;
  const sourceFps = item.sourceFps ?? fps;

  // Calculate source frame at playhead in source-native FPS
  const timelineOffset = playheadFrame - itemStart;
  const sourceFrame = sourceStart + timelineToSourceFrames(timelineOffset, speed, fps, sourceFps);

  // Get media metadata for resolution and fps info
  const mediaItems = useMediaLibraryStore.getState().mediaItems;
  const media = mediaItems.find((m) => m.id === item.mediaId);
  if (!media) {
    getLogger().error('[insertFreezeFrame] Media not found for item:', item.mediaId);
    return false;
  }

  // Calculate timestamp in seconds for frame extraction
  const mediaFps = media.fps || 30;
  const timestampSeconds = sourceFrame / mediaFps;

  try {
    // Step 1: Get the media file blob
    const blob = await mediaLibraryService.getMediaFile(media.id);
    if (!blob) {
      getLogger().error('[insertFreezeFrame] Could not access media file');
      return false;
    }

    // Step 2: Extract frame using mediabunny at native resolution
    const { Input, BlobSource, CanvasSink, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({
      source: new BlobSource(blob as File),
      formats: ALL_FORMATS,
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      input.dispose();
      getLogger().error('[insertFreezeFrame] No video track found');
      return false;
    }

    const frameWidth = videoTrack.displayWidth;
    const frameHeight = videoTrack.displayHeight;

    const sink = new CanvasSink(videoTrack, {
      width: frameWidth,
      height: frameHeight,
      fit: 'fill',
    });

    const wrapped = await sink.getCanvas(timestampSeconds);
    if (!wrapped) {
      (sink as unknown as { dispose?: () => void }).dispose?.();
      input.dispose();
      getLogger().error('[insertFreezeFrame] Failed to extract frame');
      return false;
    }

    const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement;
    let frameBlob: Blob;
    if ('convertToBlob' in canvas) {
      frameBlob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      frameBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
          'image/png'
        );
      });
    }

    // Clean up mediabunny resources
    (sink as unknown as { dispose?: () => void }).dispose?.();
    input.dispose();

    // Step 3: Store frame as media in IndexedDB
    const { createMedia, saveThumbnail, associateMediaWithProject } = await import('@/infrastructure/storage/indexeddb');
    const currentProjectId = useMediaLibraryStore.getState().currentProjectId;
    if (!currentProjectId) {
      getLogger().error('[insertFreezeFrame] No project context');
      return false;
    }

    const frameMediaId = crypto.randomUUID();
    const frameBlobUrl = blobUrlManager.acquire(frameMediaId, frameBlob);
    const fileName = `freeze-frame-${item.label || 'video'}-${Math.round(timestampSeconds * 100) / 100}s.png`;

    const mediaMetadata: MediaMetadata = {
      id: frameMediaId,
      storageType: 'opfs',
      fileName,
      fileSize: frameBlob.size,
      mimeType: 'image/png',
      duration: 0,
      width: frameWidth,
      height: frameHeight,
      fps: 0,
      codec: 'png',
      bitrate: 0,
      tags: ['freeze-frame'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Store the frame blob in OPFS
    const opfsPath = `content/${frameMediaId.slice(0, 2)}/${frameMediaId.slice(2, 4)}/${frameMediaId}/data`;
    await opfsService.saveFile(opfsPath, await frameBlob.arrayBuffer());
    mediaMetadata.opfsPath = opfsPath;

    await createMedia(mediaMetadata);
    await associateMediaWithProject(currentProjectId, frameMediaId);

    // Save thumbnail (reuse the frame blob)
    const thumbnailId = crypto.randomUUID();
    const thumbnailData: ThumbnailData = {
      id: thumbnailId,
      mediaId: frameMediaId,
      blob: frameBlob,
      timestamp: 0,
      width: frameWidth,
      height: frameHeight,
    };
    await saveThumbnail(thumbnailData);
    mediaMetadata.thumbnailId = thumbnailId;

    // Add to media library store
    useMediaLibraryStore.setState((state) => ({
      mediaItems: [mediaMetadata, ...state.mediaItems],
    }));

    // Step 4: Perform timeline mutations atomically (split + insert + shift)
    const freezeDurationFrames = Math.round(fps * 2); // 2 seconds

    execute('INSERT_FREEZE_FRAME', () => {
      // Split the video at playhead
      const splitResult = useItemsStore.getState()._splitItem(itemId, playheadFrame);
      if (!splitResult) {
        getLogger().error('[insertFreezeFrame] Split failed');
        return false;
      }

      const { leftItem, rightItem } = splitResult;

      // Update transitions pointing to split item
      const transitions = useTransitionsStore.getState().transitions;
      const updatedTransitions = transitions.map((t) => {
        if (t.leftClipId === itemId) {
          return { ...t, leftClipId: rightItem.id };
        }
        return t;
      });
      useTransitionsStore.getState().setTransitions(updatedTransitions);

      // Create ImageItem for the freeze frame
      const freezeFrameItem: ImageItem = {
        id: crypto.randomUUID(),
        type: 'image',
        trackId: item.trackId,
        from: playheadFrame,
        durationInFrames: freezeDurationFrames,
        label: fileName,
        mediaId: frameMediaId,
        src: frameBlobUrl,
        sourceWidth: frameWidth,
        sourceHeight: frameHeight,
        transform: item.transform ? { ...item.transform } : undefined,
      };

      useItemsStore.getState()._addItem(freezeFrameItem);

      // Shift the right half forward by freeze frame duration
      const newRightFrom = rightItem.from + freezeDurationFrames;
      useItemsStore.getState()._moveItem(rightItem.id, newRightFrom);

      // Also shift all items on same track that come after the right half
      const allItems = useItemsStore.getState().items;
      const itemsToShift = allItems.filter(
        (i) =>
          i.trackId === item.trackId &&
          i.id !== rightItem.id &&
          i.id !== leftItem.id &&
          i.id !== freezeFrameItem.id &&
          i.from > playheadFrame
      );

      for (const shiftItem of itemsToShift) {
        useItemsStore.getState()._moveItem(shiftItem.id, shiftItem.from + freezeDurationFrames);
      }

      // Repair transitions
      applyTransitionRepairs([leftItem.id, rightItem.id]);

      // Select the freeze frame item
      useSelectionStore.getState().selectItems([freezeFrameItem.id]);

      useTimelineSettingsStore.getState().markDirty();
    }, { itemId, playheadFrame, freezeDurationFrames });

    return true;
  } catch (error) {
    getLogger().error('[insertFreezeFrame] Failed:', error);
    return false;
  }
}

/**
 * Ripple edit: trim a clip and shift all downstream items on the same track.
 *
 * Unlike normal trim which leaves gaps, ripple edit closes or opens gaps by
 * shifting everything after the trim point.
 *
 * End handle: trims the end, shifts downstream items by the change in end position.
 * Start handle: trims the start (changes source/duration), then moves the trimmed
 *   clip back to its original `from` and shifts downstream items by the duration change.
 *
 * @param id - ID of the clip being trimmed
 * @param handle - Which handle is being dragged ('start' or 'end')
 * @param trimDelta - Frames to trim (positive = shrink start / extend end,
 *                    negative = extend start / shrink end)
 */
export function rippleTrimItem(id: string, handle: 'start' | 'end', trimDelta: number): void {
  if (trimDelta === 0) return;
  execute('RIPPLE_EDIT', () => {
    const store = useItemsStore.getState();
    const item = store.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const synced = getSynchronizedLinkedItemsForEdit(store.items, id, isLinkedSelectionEnabled());
    const syncedIds = new Set(synced.map((candidate) => candidate.id));
    const oldById = new Map(synced.map((candidate) => [candidate.id, candidate]));
    const oldFrom = item.from;
    const oldEnd = item.from + item.durationInFrames;
    if (handle === 'start') store._trimItemStart(id, trimDelta, { skipAdjacentClamp: true });
    else store._trimItemEnd(id, trimDelta, { skipAdjacentClamp: true }); 
    const trimmed = useItemsStore.getState().itemById[id];
    if (!trimmed) return;
    let shift = 0;
    let interval: { start: number; end: number } | null = null;
    let insertAt: number | null = null;
    if (handle === 'end') {
      const newEnd = trimmed.from + trimmed.durationInFrames;
      shift = newEnd - oldEnd;
      if (shift < 0) interval = { start: newEnd, end: oldEnd };
      else if (shift > 0) insertAt = oldEnd;
      for (const syncedItem of synced) {
        if (syncedItem.id !== id && shift !== 0) {
          store._trimItemEnd(syncedItem.id, shift, { skipAdjacentClamp: true });
        }
      }
    } else {
      const actual = trimmed.from - oldFrom;
      if (actual !== 0) {
        store._moveItem(id, oldFrom);
        for (const syncedItem of synced) {
          if (syncedItem.id === id) continue;
          store._trimItemStart(syncedItem.id, actual, { skipAdjacentClamp: true });
          const before = oldById.get(syncedItem.id);
          if (before) store._moveItem(syncedItem.id, before.from);
        }
      }
      shift = -actual;
      if (shift < 0) interval = { start: oldEnd + shift, end: oldEnd };
      else if (shift > 0) insertAt = oldEnd;
    }
    let lockedAffected: string[] = [];
    let lockedRemoved: string[] = [];
    if (shift !== 0) {
      const fresh = useItemsStore.getState().items;
      const deltas = new Map<string, number>();
      const transitions = useTransitionsStore.getState().transitions;
      for (const syncedItem of synced) {
        const before = oldById.get(syncedItem.id);
        if (!before) continue;
        const oldSyncedEnd = before.from + before.durationInFrames;
        const neighbors = new Set<string>();
        for (const transition of transitions) {
          if (transition.leftClipId === syncedItem.id) neighbors.add(transition.rightClipId);
        }
        for (const candidate of fresh) {
          if (syncedIds.has(candidate.id) || candidate.trackId !== before.trackId) continue;
          if (candidate.from >= oldSyncedEnd || neighbors.has(candidate.id)) deltas.set(candidate.id, shift);
        }
      }
      const updates = fresh.flatMap((candidate) => {
        const delta = deltas.get(candidate.id) ?? 0;
        return delta === 0 ? [] : [{ id: candidate.id, from: candidate.from + delta }];
      });
      if (updates.length > 0) store._moveItems(updates);
      const editedTracks = new Set(synced.map((candidate) => candidate.trackId));
      if (interval) {
        const result = propagateRemovedIntervalsToSyncLockedTracks({ editedTrackIds: editedTracks, intervals: [interval] });
        lockedAffected = result.affectedIds;
        lockedRemoved = result.removedIds;
      } else if (insertAt !== null) {
        const result = propagateInsertedGapToSyncLockedTracks({ editedTrackIds: editedTracks, cutFrame: insertAt, amount: shift });
        lockedAffected = result.affectedIds;
      }
    }
    const final = useItemsStore.getState().items;
    const affected = Array.from(new Set([
      ...synced.map((candidate) => candidate.id),
      ...lockedAffected,
      ...final
        .filter((candidate) => !syncedIds.has(candidate.id) && synced.some((syncedItem) => candidate.trackId === syncedItem.trackId && candidate.from >= syncedItem.from))
        .map((candidate) => candidate.id),
    ]));
    if (lockedRemoved.length > 0) {
      useTransitionsStore.getState()._removeTransitionsForItems(lockedRemoved);
      useKeyframesStore.getState()._removeKeyframesForItems(lockedRemoved);
    }
    applyTransitionRepairs(affected, lockedRemoved.length > 0 ? new Set(lockedRemoved) : undefined);
    useTimelineSettingsStore.getState().markDirty();
  }, { id, handle, trimDelta });
}

/**
 * Rolling edit                                                                                                                                                                                                                                                                                                                    
 * Trims the left clip's end and the right clip's start by the same amount,
 * keeping total timeline duration unchanged.
 *
 * @param leftId - ID of the left clip (its end edge is being adjusted)
 * @param rightId - ID of the right clip (its start edge is being adjusted)
 * @param editPointDelta - Frames to move the edit point (positive = right, negative = left)
 */
export function rollingTrimItems(leftId: string, rightId: string, editPointDelta: number): void {
  if (editPointDelta === 0) return;

  execute('ROLLING_EDIT', () => {
    const itemsStore = useItemsStore.getState();
    const itemsBefore = itemsStore.items;
    const counterpartPair = getSynchronizedLinkedCounterpartPairForEdit(
      itemsBefore,
      leftId,
      rightId,
      isLinkedSelectionEnabled(),
    );
    const rightBefore = itemsBefore.find((item) => item.id === rightId);
    if (!rightBefore) return;

    // Order matters: shrink first, then extend. The internal _trimItemEnd/_trimItemStart
    // methods have clampToAdjacentItems guards that prevent extending into a neighbor.
    // By shrinking the losing clip first, we free up space for the gaining clip to extend into.
    if (editPointDelta > 0) {
      // Edit point moves right: right clip shrinks (frees space), then left clip extends
      itemsStore._trimItemStart(rightId, editPointDelta);
      itemsStore._trimItemEnd(leftId, editPointDelta);
    } else {
      // Edit point moves left: left clip shrinks (frees space), then right clip extends
      itemsStore._trimItemEnd(leftId, editPointDelta);
      itemsStore._trimItemStart(rightId, editPointDelta);
    }

    const rightAfter = useItemsStore.getState().itemById[rightId];
      const actualDelta = rightAfter ? rightAfter.from - rightBefore.from : 0;

      if (counterpartPair && actualDelta !== 0) {
        if (actualDelta > 0) {
          itemsStore._trimItemStart(counterpartPair.rightCounterpart.id, actualDelta, { skipAdjacentClamp: true });
          itemsStore._trimItemEnd(counterpartPair.leftCounterpart.id, actualDelta, { skipAdjacentClamp: true });
        } else {
          itemsStore._trimItemEnd(counterpartPair.leftCounterpart.id, actualDelta, { skipAdjacentClamp: true });
          itemsStore._trimItemStart(counterpartPair.rightCounterpart.id, actualDelta, { skipAdjacentClamp: true });
        }
      }

    // Repair transitions for both clips
    applyTransitionRepairs(counterpartPair
      ? [leftId, rightId, counterpartPair.leftCounterpart.id, counterpartPair.rightCounterpart.id]
      : [leftId, rightId]);

    useTimelineSettingsStore.getState().markDirty();
  }, { leftId, rightId, editPointDelta });
}

/**
 * Slip edit: shift the source window (sourceStart/sourceEnd) within a clip
 * without changing its position or duration on the timeline.
 *
 * Only works on video/audio items that have explicit source bounds.
 *
 * @param id - ID of the clip to slip
 * @param slipDelta - Frames to shift the source window (positive = later in source, negative = earlier)
 */
export function slipItem(id: string, slipDelta: number): void {
  if (slipDelta === 0) return;

  execute('SLIP_EDIT', () => {
    const itemsStore = useItemsStore.getState();
    const items = itemsStore.items;
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') return;
    const synchronizedItems = getSynchronizedLinkedItemsForEdit(items, id, isLinkedSelectionEnabled());

    const sourceStart = item.sourceStart ?? 0;
    const sourceEnd = item.sourceEnd;
    const sourceDuration = item.sourceDuration;
    if (sourceEnd === undefined) return;

    const clamped = computeClampedSlipDelta(sourceStart, sourceEnd, sourceDuration, slipDelta);

    if (clamped === 0) return;

    itemsStore._updateItem(id, {
      sourceStart: sourceStart + clamped,
      sourceEnd: sourceEnd + clamped,
    });

    for (const synchronizedItem of synchronizedItems) {
      if (synchronizedItem.id === id || synchronizedItem.sourceEnd === undefined) continue;
      itemsStore._updateItem(synchronizedItem.id, {
        sourceStart: (synchronizedItem.sourceStart ?? 0) + clamped,
        sourceEnd: synchronizedItem.sourceEnd + clamped,
      });
    }

    applyTransitionRepairs(synchronizedItems.map((synchronizedItem) => synchronizedItem.id));

    useTimelineSettingsStore.getState().markDirty();
  }, { id, slipDelta });
}

/**
 * Slide edit: move a clip on the timeline while adjusting its neighboring clips.
 * The left neighbor's end extends/shrinks and the right neighbor's start extends/shrinks,
 * keeping total timeline duration unchanged.
 *
 * @param id - ID of the clip being slid
 * @param slideDelta - Frames to slide (positive = right, negative = left)
 * @param leftNeighborId - ID of the left adjacent clip (null if none)
 * @param rightNeighborId - ID of the right adjacent clip (null if none)
 */
export function slideItem(
  id: string,
  slideDelta: number,
  leftNeighborId: string | null,
  rightNeighborId: string | null,
): void {
  if (slideDelta === 0) return;

  execute('SLIDE_EDIT', () => {
    const itemsStore = useItemsStore.getState();
    const items = itemsStore.items;
    const transitions = useTransitionsStore.getState().transitions;
    // Verify the target clip exists before mutating neighbors
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const leftNeighbor = leftNeighborId ? (items.find((i) => i.id === leftNeighborId) ?? null) : null;
    const rightNeighbor = rightNeighborId ? (items.find((i) => i.id === rightNeighborId) ?? null) : null;
    const clampedSlideDelta = clampSlideDeltaToPreserveTransitions(
      item,
      slideDelta,
      leftNeighbor,
      rightNeighbor,
      items,
      transitions,
      useTimelineSettingsStore.getState().fps,
    );
    if (clampedSlideDelta === 0) return;
    const synchronizedCounterpart = getSynchronizedLinkedItemsForEdit(items, id, isLinkedSelectionEnabled())
      .find((candidate) => candidate.id !== id) ?? null;
    const leftCounterpart = synchronizedCounterpart && leftNeighborId
      ? getMatchingSynchronizedLinkedCounterpartForEdit(
        items,
        leftNeighborId,
        synchronizedCounterpart.trackId,
        synchronizedCounterpart.type,
        isLinkedSelectionEnabled(),
      )
      : null;
    const rightCounterpart = synchronizedCounterpart && rightNeighborId
      ? getMatchingSynchronizedLinkedCounterpartForEdit(
        items,
        rightNeighborId,
        synchronizedCounterpart.trackId,
        synchronizedCounterpart.type,
        isLinkedSelectionEnabled(),
      )
      : null;
    const itemFromBefore = item.from;
    const itemSourceStartBefore = item.sourceStart;

    // For split-contiguous A-B-C chains, preserve source continuity by shifting
    // the slid clip's source window by the same source-space delta as slide.
    const continuitySourceDelta = computeSlideContinuitySourceDelta(
      item,
      leftNeighbor,
      rightNeighbor,
      clampedSlideDelta,
      useTimelineSettingsStore.getState().fps,
    );

    // Adjust neighbors (order: shrink first, then extend — same as rolling edit)
    if (clampedSlideDelta > 0) {
      // Sliding right: right neighbor shrinks start (frees space), left neighbor extends end
      if (rightNeighborId) {
        itemsStore._trimItemStart(rightNeighborId, clampedSlideDelta, { skipAdjacentClamp: true });
      }
      if (leftNeighborId) {
        itemsStore._trimItemEnd(leftNeighborId, clampedSlideDelta, { skipAdjacentClamp: true });
      }
    } else {
      // Sliding left: left neighbor shrinks end (frees space), right neighbor extends start
      if (leftNeighborId) {
        itemsStore._trimItemEnd(leftNeighborId, clampedSlideDelta, { skipAdjacentClamp: true });
      }
      if (rightNeighborId) {
        itemsStore._trimItemStart(rightNeighborId, clampedSlideDelta, { skipAdjacentClamp: true });
      }
    }

    // Move the slid clip
    itemsStore._moveItem(id, item.from + clampedSlideDelta);
    if (
      continuitySourceDelta !== 0
      && (item.type === 'video' || item.type === 'audio' || item.type === 'composition')
      && item.sourceEnd !== undefined
    ) {
      itemsStore._updateItem(id, {
        sourceStart: (item.sourceStart ?? 0) + continuitySourceDelta,
        sourceEnd: item.sourceEnd + continuitySourceDelta,
      });
    }

    const updatedItem = useItemsStore.getState().itemById[id];
    const actualSlideDelta = updatedItem ? updatedItem.from - itemFromBefore : 0;
    const actualSourceDelta = updatedItem && itemSourceStartBefore !== undefined && updatedItem.sourceStart !== undefined
      ? updatedItem.sourceStart - itemSourceStartBefore
      : 0;

    // Find the companion's own adjacent neighbors — may differ from the
    // primary's linked counterparts (e.g. a solo audio clip next to the
    // companion that has no video counterpart).
    let cpLeftAdj: TimelineItem | null = null;
    let cpRightAdj: TimelineItem | null = null;
    if (synchronizedCounterpart) {
      const cpEnd = synchronizedCounterpart.from + synchronizedCounterpart.durationInFrames;
      const freshItems = useItemsStore.getState().items;
      cpLeftAdj = freshItems.find((i) =>
        i.trackId === synchronizedCounterpart.trackId
        && i.id !== synchronizedCounterpart.id
        && i.from + i.durationInFrames === synchronizedCounterpart.from
      ) ?? leftCounterpart;
      cpRightAdj = freshItems.find((i) =>
        i.trackId === synchronizedCounterpart.trackId
        && i.id !== synchronizedCounterpart.id
        && i.from === cpEnd
      ) ?? rightCounterpart;
    }

    if (synchronizedCounterpart && actualSlideDelta !== 0) {
      if (actualSlideDelta > 0) {
        if (cpRightAdj) {
          itemsStore._trimItemStart(cpRightAdj.id, actualSlideDelta, { skipAdjacentClamp: true });
        }
        if (cpLeftAdj) {
          itemsStore._trimItemEnd(cpLeftAdj.id, actualSlideDelta, { skipAdjacentClamp: true });
        }
      } else {
        if (cpLeftAdj) {
          itemsStore._trimItemEnd(cpLeftAdj.id, actualSlideDelta, { skipAdjacentClamp: true });
        }
        if (cpRightAdj) {
          itemsStore._trimItemStart(cpRightAdj.id, actualSlideDelta, { skipAdjacentClamp: true });
        }
      }

      itemsStore._moveItem(synchronizedCounterpart.id, synchronizedCounterpart.from + actualSlideDelta);
      if (
        actualSourceDelta !== 0
        && (synchronizedCounterpart.type === 'video' || synchronizedCounterpart.type === 'audio')
        && synchronizedCounterpart.sourceEnd !== undefined
      ) {
        itemsStore._updateItem(synchronizedCounterpart.id, {
          sourceStart: (synchronizedCounterpart.sourceStart ?? 0) + actualSourceDelta,
          sourceEnd: synchronizedCounterpart.sourceEnd + actualSourceDelta,
        });
      }
    }

    // Repair transitions for all affected items
    const affectedIds = [id];
    if (leftNeighborId) affectedIds.push(leftNeighborId);
    if (rightNeighborId) affectedIds.push(rightNeighborId);
    if (synchronizedCounterpart) {
      affectedIds.push(synchronizedCounterpart.id);
      if (cpLeftAdj) affectedIds.push(cpLeftAdj.id);
      if (cpRightAdj) affectedIds.push(cpRightAdj.id);
    }
    applyTransitionRepairs(affectedIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, slideDelta, leftNeighborId, rightNeighborId });
}
