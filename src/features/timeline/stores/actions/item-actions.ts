/**
 * Item Actions - Cross-domain operations that affect items, transitions, and keyframes.
 */

import type { TimelineItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { execute, applyTransitionRepairs } from './shared';

export function addItem(item: TimelineItem): void {
  execute('ADD_ITEM', () => {
    useItemsStore.getState()._addItem(item);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId: item.id, type: item.type });
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

export function removeItems(ids: string[]): void {
  execute('REMOVE_ITEMS', () => {
    // Remove items
    useItemsStore.getState()._removeItems(ids);

    // Cascade: Remove transitions referencing deleted items
    useTransitionsStore.getState()._removeTransitionsForItems(ids);

    // Cascade: Remove keyframes for deleted items
    useKeyframesStore.getState()._removeKeyframesForItems(ids);

    useTimelineSettingsStore.getState().markDirty();
  }, { ids });
}

export function rippleDeleteItems(ids: string[]): void {
  execute('RIPPLE_DELETE_ITEMS', () => {
    useItemsStore.getState()._rippleDeleteItems(ids);

    // Cascade: Remove transitions and keyframes
    useTransitionsStore.getState()._removeTransitionsForItems(ids);
    useKeyframesStore.getState()._removeKeyframesForItems(ids);

    useTimelineSettingsStore.getState().markDirty();
  }, { ids });
}

export function closeGapAtPosition(trackId: string, frame: number): void {
  execute('CLOSE_GAP', () => {
    useItemsStore.getState()._closeGapAtPosition(trackId, frame);

    // Repair all transitions on this track
    const items = useItemsStore.getState().items;
    const trackItemIds = items.filter((i) => i.trackId === trackId).map((i) => i.id);
    applyTransitionRepairs(trackItemIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { trackId, frame });
}

export function moveItem(id: string, newFrom: number, newTrackId?: string): void {
  execute('MOVE_ITEM', () => {
    useItemsStore.getState()._moveItem(id, newFrom, newTrackId);

    // Repair transitions
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
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
  }, { count: updates.length });
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

export function trimItemStart(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_START', () => {
    useItemsStore.getState()._trimItemStart(id, trimAmount);

    // Repair transitions (auto-adjusts duration if clip got shorter)
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

export function trimItemEnd(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_END', () => {
    useItemsStore.getState()._trimItemEnd(id, trimAmount);

    // Repair transitions (auto-adjusts duration if clip got shorter)
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

export function splitItem(
  id: string,
  splitFrame: number
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
  return execute('SPLIT_ITEM', () => {
    const result = useItemsStore.getState()._splitItem(id, splitFrame);
    if (!result) return null;

    const { rightItem } = result;

    // Update transitions pointing to split item
    const transitions = useTransitionsStore.getState().transitions;
    const updatedTransitions = transitions.map((t) => {
      if (t.leftClipId === id) {
        // Transition was from this clip - now from right half
        return { ...t, leftClipId: rightItem.id };
      }
      if (t.rightClipId === id) {
        // Transition was to this clip - stays pointing to left half (original ID)
        return t;
      }
      return t;
    });
    useTransitionsStore.getState().setTransitions(updatedTransitions);

    // Keep selection anchored to the split clip for immediate downstream
    // adjacency/transition detection across all split entry points.
    useSelectionStore.getState().selectItems([result.leftItem.id]);

    useTimelineSettingsStore.getState().markDirty();
    return result;
  }, { id, splitFrame });
}

export function joinItems(itemIds: string[]): void {
  execute('JOIN_ITEMS', () => {
    useItemsStore.getState()._joinItems(itemIds);

    // Remove keyframes for joined items (except first)
    if (itemIds.length > 1) {
      useKeyframesStore.getState()._removeKeyframesForItems(itemIds.slice(1));
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
    // Get old duration BEFORE applying rate stretch (needed for keyframe scaling)
    const oldItem = useItemsStore.getState().items.find((i) => i.id === id);
    const oldDuration = oldItem?.durationInFrames ?? newDuration;

    useItemsStore.getState()._rateStretchItem(id, newFrom, newDuration, newSpeed);

    // Scale keyframes proportionally to match new duration
    // This ensures animations maintain their relative timing within the clip
    if (oldDuration !== newDuration) {
      useKeyframesStore.getState()._scaleKeyframesForItem(id, oldDuration, newDuration);
    }

    // Repair transitions
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, newFrom, newDuration, newSpeed });
}
