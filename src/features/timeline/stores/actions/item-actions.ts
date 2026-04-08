/**
 * Item Actions - Cross-domain operations that affect items, transitions, and keyframes.
 */

import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useEditorStore } from '@/shared/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import { execute, applyTransitionRepairs, warnIfOverlapping } from './shared';
import {
  buildLinkedLeftShiftUpdates,
  expandIdsWithLinkedItems,
} from './linked-edit';
import {
  canLinkSelection,
  expandSelectionWithLinkedItems,
  getLinkedItemIds,
} from '../../utils/linked-items';
import { placeItemsWithoutTimelineOverlap } from './item-placement';

function isLinkedSelectionEnabled(): boolean {
  return useEditorStore.getState().linkedSelectionEnabled;
}

export function addItem(item: TimelineItem): void {
  const [placedItem] = placeItemsWithoutTimelineOverlap([item]);
  if (!placedItem) return;

  execute('ADD_ITEM', () => {
    useItemsStore.getState()._addItem(placedItem);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId: placedItem.id, type: placedItem.type });
}

export function addItems(items: TimelineItem[]): void {
  if (items.length === 0) return;
  const placedItems = placeItemsWithoutTimelineOverlap(items);

  execute('ADD_ITEMS', () => {
    useItemsStore.getState()._addItems(placedItems);
    useTimelineSettingsStore.getState().markDirty();
  }, { count: placedItems.length });
}

export function updateItem(id: string, updates: Partial<TimelineItem>): void {
  execute('UPDATE_ITEM', () => {
    useItemsStore.getState()._updateItem(id, updates);

    // Repair transitions if position changed
    const positionChanged = 'from' in updates || 'durationInFrames' in updates || 'trackId' in updates;
    if (positionChanged) {
      applyTransitionRepairs([id]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, updates });
}

export function unlinkItems(ids: string[]): void {
  const items = useItemsStore.getState().items;
  const unlinkIds = new Set<string>();

  for (const id of ids) {
    for (const linkedId of getLinkedItemIds(items, id)) {
      unlinkIds.add(linkedId);
    }
  }

  const linkedItems = items.filter((item) => unlinkIds.has(item.id) && item.linkedGroupId);
  if (linkedItems.length === 0) return;

  // Detect video items that have a linked audio companion — their embedded audio
  // should be muted after unlinking so it doesn't start playing when the audio is deleted.
  const videoIdsWithAudioCompanion = new Set<string>();
  for (const item of linkedItems) {
    if (item.type === 'video') {
      const hasAudio = linkedItems.some(
        (other) => other.type === 'audio' && other.linkedGroupId === item.linkedGroupId,
      );
      if (hasAudio) videoIdsWithAudioCompanion.add(item.id);
    }
  }

  execute('UNLINK_ITEMS', () => {
    const store = useItemsStore.getState();
    for (const item of linkedItems) {
      store._updateItem(item.id, {
        linkedGroupId: item.id,
        ...(videoIdsWithAudioCompanion.has(item.id) && { embeddedAudioMuted: true }),
      });
    }
    useSelectionStore.getState().selectItems(linkedItems.map((item) => item.id));
    useTimelineSettingsStore.getState().markDirty();
  }, { ids: linkedItems.map((item) => item.id) });
}

export function linkItems(ids: string[]): boolean {
  const items = useItemsStore.getState().items;
  const expandedIds = expandSelectionWithLinkedItems(items, ids);
  const selectedItems = expandedIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is TimelineItem => item !== undefined);

  if (!canLinkSelection(items, ids) || selectedItems.length < 2) {
    return false;
  }

  const linkedGroupId = crypto.randomUUID();
  execute('LINK_ITEMS', () => {
    const store = useItemsStore.getState();
    for (const item of selectedItems) {
      store._updateItem(item.id, {
        linkedGroupId,
        ...(item.type === 'video' && { embeddedAudioMuted: undefined }),
      });
    }
    useSelectionStore.getState().selectItems(selectedItems.map((item) => item.id));
    useTimelineSettingsStore.getState().markDirty();
  }, { ids: selectedItems.map((item) => item.id) });

  return true;
}

export function removeItems(ids: string[]): void {
  const expandedIds = expandIdsWithLinkedItems(useItemsStore.getState().items, ids, isLinkedSelectionEnabled());
  if (expandedIds.length === 0) return;

  execute('REMOVE_ITEMS', () => {
    // Remove items
    useItemsStore.getState()._removeItems(expandedIds);

    // Cascade: Remove transitions referencing deleted items
    useTransitionsStore.getState()._removeTransitionsForItems(expandedIds);

    // Cascade: Remove keyframes for deleted items
    useKeyframesStore.getState()._removeKeyframesForItems(expandedIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { ids: expandedIds });
}

export function rippleDeleteItems(ids: string[]): void {
  const items = useItemsStore.getState().items;
  const linkedSelectionEnabled = isLinkedSelectionEnabled();
  const expandedIds = expandIdsWithLinkedItems(items, ids, linkedSelectionEnabled);
  if (expandedIds.length === 0) return;

  const idsToDelete = new Set(expandedIds);
  const remainingItems = items.filter((item) => !idsToDelete.has(item.id));
  const baseShiftByItemId = new Map<string, number>();

  // Per-track: shift downstream items on the same track as each deleted item.
  // Linked counterparts on other tracks shift via buildLinkedLeftShiftUpdates.
  // Solo clips on unrelated tracks are left in place.
  for (const item of remainingItems) {
    const shiftAmount = items
      .filter((candidate) => idsToDelete.has(candidate.id))
      .filter((deletedItem) => deletedItem.trackId === item.trackId && deletedItem.from + deletedItem.durationInFrames <= item.from)
      .reduce((sum, deletedItem) => sum + deletedItem.durationInFrames, 0);

    if (shiftAmount > 0) {
      baseShiftByItemId.set(item.id, shiftAmount);
    }
  }

  const updates = buildLinkedLeftShiftUpdates(remainingItems, baseShiftByItemId, linkedSelectionEnabled);

  // Detect non-shifted items that would be overlapped by shifted items.
  // These get deleted rather than creating overlaps.
  const shiftedById = new Map(updates.map((u) => [u.id, u.from]));
  const coveredIds: string[] = [];
  for (const item of remainingItems) {
    if (shiftedById.has(item.id) || idsToDelete.has(item.id)) continue;
    const itemEnd = item.from + item.durationInFrames;
    // Check if any shifted item on the same track would overlap this item
    for (const other of remainingItems) {
      const newFrom = shiftedById.get(other.id);
      if (newFrom === undefined || other.trackId !== item.trackId) continue;
      const newEnd = newFrom + other.durationInFrames;
      if (newFrom < itemEnd && newEnd > item.from) {
        coveredIds.push(item.id);
        break;
      }
    }
  }

  // Expand covered IDs with linked companions so we don't orphan them
  const expandedCoveredIds = expandIdsWithLinkedItems(
    remainingItems,
    coveredIds,
    linkedSelectionEnabled,
  );
  const allRemoveIds = [...expandedIds, ...expandedCoveredIds];

  // Filter out updates for items that were removed as covered (including their linked companions)
  const coveredSet = new Set(expandedCoveredIds);
  const filteredUpdates = coveredSet.size > 0
    ? updates.filter((u) => !coveredSet.has(u.id))
    : updates;

  execute('RIPPLE_DELETE_ITEMS', () => {
    useItemsStore.getState()._removeItems(allRemoveIds);
    if (filteredUpdates.length > 0) {
      useItemsStore.getState()._moveItems(filteredUpdates);
    }

    // Cascade: Remove transitions and keyframes
    useTransitionsStore.getState()._removeTransitionsForItems(allRemoveIds);
    useKeyframesStore.getState()._removeKeyframesForItems(allRemoveIds);

    // Repair transitions on moved clips (they may now overlap or gap differently)
    if (filteredUpdates.length > 0) {
      applyTransitionRepairs(filteredUpdates.map((u) => u.id));
    }

    // Repair transitions for surviving clips that were shifted
    if (updates.length > 0) {
      const movedClipIds = updates.map((update) => update.id);
      applyTransitionRepairs(movedClipIds, new Set(expandedIds));
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { ids: allRemoveIds });
}

export function closeGapAtPosition(trackId: string, frame: number): void {
  const items = useItemsStore.getState().items;
  const targetFrame = Math.max(0, Math.round(frame));
  const trackItems = items
    .filter((item) => item.trackId === trackId)
    .sort((left, right) => left.from - right.from);

  if (trackItems.length === 0) return;

  let gapStart = 0;
  let gapEnd = 0;

  for (const item of trackItems) {
    if (targetFrame >= gapStart && targetFrame < item.from) {
      gapEnd = item.from;
      break;
    }
    gapStart = item.from + item.durationInFrames;
  }

  if (gapEnd <= gapStart) return;

  const gapSize = gapEnd - gapStart;
  const baseShiftByItemId = new Map<string, number>();
  for (const item of items) {
    // Shift ALL items at or after the gap end across every track
    if (item.from >= gapEnd) {
      baseShiftByItemId.set(item.id, gapSize);
    }
  }

  const updates = buildLinkedLeftShiftUpdates(items, baseShiftByItemId, isLinkedSelectionEnabled());
  if (updates.length === 0) return;

  // Detect non-shifted items that would be overlapped by shifted items — delete them.
  const shiftedById = new Map(updates.map((u) => [u.id, u.from]));
  const coveredIds: string[] = [];
  for (const item of items) {
    if (shiftedById.has(item.id)) continue;
    const itemEnd = item.from + item.durationInFrames;
    for (const other of items) {
      const newFrom = shiftedById.get(other.id);
      if (newFrom === undefined || other.trackId !== item.trackId) continue;
      const newEnd = newFrom + other.durationInFrames;
      if (newFrom < itemEnd && newEnd > item.from) {
        coveredIds.push(item.id);
        break;
      }
    }
  }

  execute('CLOSE_GAP', () => {
    if (coveredIds.length > 0) {
      useItemsStore.getState()._removeItems(coveredIds);
      useTransitionsStore.getState()._removeTransitionsForItems(coveredIds);
      useKeyframesStore.getState()._removeKeyframesForItems(coveredIds);
    }
    useItemsStore.getState()._moveItems(updates);

    applyTransitionRepairs(updates.map((update) => update.id));

    useTimelineSettingsStore.getState().markDirty();
  }, { trackId, frame });
}

export function closeAllGapsOnTrack(trackId: string): void {
  const items = useItemsStore.getState().items;
  const trackItems = items
    .filter((item) => item.trackId === trackId)
    .sort((left, right) => left.from - right.from);

  if (trackItems.length === 0) return;

  let cursor = 0;
  const baseShiftByItemId = new Map<string, number>();
  for (const item of trackItems) {
    const newFrom = item.from > cursor ? cursor : item.from;
    const shiftAmount = item.from - newFrom;
    if (shiftAmount > 0) {
      baseShiftByItemId.set(item.id, shiftAmount);
    }
    cursor = newFrom + item.durationInFrames;
  }

  const updates = buildLinkedLeftShiftUpdates(items, baseShiftByItemId, isLinkedSelectionEnabled());
  if (updates.length === 0) return;

  execute('CLOSE_ALL_GAPS', () => {
    useItemsStore.getState()._moveItems(updates);
    applyTransitionRepairs(updates.map((update) => update.id));
    useTimelineSettingsStore.getState().markDirty();
  }, { trackId });
}

/**
 * Track push: move ALL items at or after the anchor clip's position — across
 * every track — by the given frame delta.  This is a multi-track ripple
 * move that closes or opens a gap at the anchor point.
 * Commits as a single undo entry.
 */
export function trackPushItems(anchorId: string, delta: number): void {
  if (delta === 0) return;

  const items = useItemsStore.getState().items;
  const anchor = items.find((i) => i.id === anchorId);
  if (!anchor) return;

  const cutFrame = anchor.from;

  // Every item whose start is at or after the cut frame gets shifted
  const updates: Array<{ id: string; from: number }> = [];
  for (const ti of items) {
    if (ti.from >= cutFrame) {
      updates.push({ id: ti.id, from: Math.max(0, ti.from + delta) });
    }
  }

  if (updates.length === 0) return;

  execute('TRACK_PUSH', () => {
    useItemsStore.getState()._moveItems(updates);
    applyTransitionRepairs(updates.map((u) => u.id));
    useTimelineSettingsStore.getState().markDirty();
  }, { anchorId, delta });
}

export function moveItem(id: string, newFrom: number, newTrackId?: string): void {
  execute('MOVE_ITEM', () => {
    useItemsStore.getState()._moveItem(id, newFrom, newTrackId);

    // Repair transitions
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
    warnIfOverlapping('MOVE_ITEM');
  }, { id, newFrom, newTrackId });
}

export function moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
  execute('MOVE_ITEMS', () => {
    useItemsStore.getState()._moveItems(updates);

    const movedItemIds = new Set(updates.map((u) => u.id));
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;

    // Update transition trackIds when both clips of a pair move together
    const updatedTransitions = transitions.map((t) => {
      const leftMoved = movedItemIds.has(t.leftClipId);
      const rightMoved = movedItemIds.has(t.rightClipId);

      if (leftMoved && rightMoved) {
        const leftClip = items.find((i) => i.id === t.leftClipId);
        const rightClip = items.find((i) => i.id === t.rightClipId);

        // If they're now on the same track, update transition trackId
        if (leftClip && rightClip && leftClip.trackId === rightClip.trackId) {
          return { ...t, trackId: leftClip.trackId };
        }
      }
      return t;
    });

    // Apply updated transitions (with trackId fixes) then repair
    useTransitionsStore.getState().setTransitions(updatedTransitions);
    applyTransitionRepairs(updates.map((u) => u.id));

    useTimelineSettingsStore.getState().markDirty();
    warnIfOverlapping('MOVE_ITEMS');
  }, { count: updates.length });
}

export function moveItemsWithTrackChanges(
  tracks: TimelineTrack[],
  updates: Array<{ id: string; from: number; trackId?: string }>
): void {
  execute('MOVE_ITEMS_WITH_TRACKS', () => {
    useItemsStore.getState().setTracks(tracks);
    useItemsStore.getState()._moveItems(updates);

    const movedItemIds = new Set(updates.map((u) => u.id));
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;

    const updatedTransitions = transitions.map((t) => {
      const leftMoved = movedItemIds.has(t.leftClipId);
      const rightMoved = movedItemIds.has(t.rightClipId);

      if (leftMoved && rightMoved) {
        const leftClip = items.find((i) => i.id === t.leftClipId);
        const rightClip = items.find((i) => i.id === t.rightClipId);

        if (leftClip && rightClip && leftClip.trackId === rightClip.trackId) {
          return { ...t, trackId: leftClip.trackId };
        }
      }
      return t;
    });

    useTransitionsStore.getState().setTransitions(updatedTransitions);
    applyTransitionRepairs(updates.map((u) => u.id));
    useTimelineSettingsStore.getState().markDirty();
    warnIfOverlapping('MOVE_ITEMS_WITH_TRACKS');
  }, { count: updates.length, trackCount: tracks.length });
}

export function duplicateItems(
  itemIds: string[],
  positions: Array<{ from: number; trackId: string }>
): TimelineItem[] {
  return execute('DUPLICATE_ITEMS', () => {
    const newItems = useItemsStore.getState()._duplicateItems(itemIds, positions);
    useTimelineSettingsStore.getState().markDirty();
    return newItems;
  }, { itemIds, count: positions.length });
}

export function duplicateItemsWithTrackChanges(
  tracks: TimelineTrack[],
  itemIds: string[],
  positions: Array<{ from: number; trackId: string }>
): TimelineItem[] {
  return execute('DUPLICATE_ITEMS_WITH_TRACKS', () => {
    useItemsStore.getState().setTracks(tracks);
    const newItems = useItemsStore.getState()._duplicateItems(itemIds, positions);
    useTimelineSettingsStore.getState().markDirty();
    return newItems;
  }, { itemIds, count: positions.length, trackCount: tracks.length });
}


export * from './item-edit-actions';
