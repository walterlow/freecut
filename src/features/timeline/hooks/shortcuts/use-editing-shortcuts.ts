/**
 * Editing shortcuts: Delete, Ripple Delete, Join, Split, Keyframes.
 */

import { useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import { canJoinMultipleItems } from '@/features/timeline/utils/clip-utils';
import { insertFreezeFrame } from '../../stores/actions/item-actions';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/features/timeline/deps/composition-runtime';
import {
  resolveAnimatedTransform,
  isFrameInTransitionRegion,
} from '@/features/timeline/deps/keyframes';
import type { TransformProperties } from '@/types/transform';
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts';
import { useClearKeyframesDialogStore } from '@/shared/state/clear-keyframes-dialog';

export function useEditingShortcuts(callbacks: TimelineShortcutCallbacks) {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const removeItems = useTimelineStore((s) => s.removeItems);
  const removeMarker = useTimelineStore((s) => s.removeMarker);
  const removeTransition = useTimelineStore((s) => s.removeTransition);
  const rippleDeleteItems = useTimelineStore((s) => s.rippleDeleteItems);
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap);
  const joinItems = useTimelineStore((s) => s.joinItems);
  const splitItem = useTimelineStore((s) => s.splitItem);
  const items = useTimelineStore((s) => s.items);

  const nudgeSelectedVisualItems = useCallback((deltaX: number, deltaY: number) => {
    if (selectedItemIds.length === 0) return;
    if (deltaX === 0 && deltaY === 0) return;

    const transforms = new Map<string, Partial<TransformProperties>>();
    for (const itemId of selectedItemIds) {
      const item = items.find((entry) => entry.id === itemId);
      if (!item || item.type === 'audio') continue;
      const defaultTransform: Partial<TransformProperties> = item.transform ?? { x: 0, y: 0 };
      const nextX = Math.round((defaultTransform.x ?? 0) + deltaX);
      const nextY = Math.round((defaultTransform.y ?? 0) + deltaY);

      transforms.set(itemId, {
        ...defaultTransform,
        x: nextX,
        y: nextY,
      });
    }

    if (transforms.size === 0) return;
    updateItemsTransformMap(transforms, { operation: 'move' });
  }, [selectedItemIds, items, updateItemsTransformMap]);

  // Editing: Delete - Delete selected items, marker, or transition
  useHotkeys(
    HOTKEYS.DELETE_SELECTED,
    (event) => {
      if (selectedTransitionId) {
        event.preventDefault();
        removeTransition(selectedTransitionId);
        clearSelection();
        return;
      }
      if (selectedMarkerId) {
        event.preventDefault();
        removeMarker(selectedMarkerId);
        clearSelection();
        return;
      }
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        removeItems(selectedItemIds);
        if (callbacks.onDelete) {
          callbacks.onDelete();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, selectedMarkerId, selectedTransitionId, removeItems, removeMarker, removeTransition, clearSelection, callbacks]
  );

  // Editing: Backspace - Delete selected items, marker, or transition (alternative)
  useHotkeys(
    HOTKEYS.DELETE_SELECTED_ALT,
    (event) => {
      if (selectedTransitionId) {
        event.preventDefault();
        removeTransition(selectedTransitionId);
        clearSelection();
        return;
      }
      if (selectedMarkerId) {
        event.preventDefault();
        removeMarker(selectedMarkerId);
        clearSelection();
        return;
      }
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        removeItems(selectedItemIds);
        if (callbacks.onDelete) {
          callbacks.onDelete();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, selectedMarkerId, selectedTransitionId, removeItems, removeMarker, removeTransition, clearSelection, callbacks]
  );

  // Editing: Ctrl+Delete - Ripple delete selected items (delete + close gap)
  useHotkeys(
    HOTKEYS.RIPPLE_DELETE,
    (event) => {
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        rippleDeleteItems(selectedItemIds);
        clearSelection();
        if (callbacks.onDelete) {
          callbacks.onDelete();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, rippleDeleteItems, clearSelection, callbacks]
  );

  // Editing: Ctrl+Backspace - Ripple delete selected items (alternative)
  useHotkeys(
    HOTKEYS.RIPPLE_DELETE_ALT,
    (event) => {
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        rippleDeleteItems(selectedItemIds);
        clearSelection();
        if (callbacks.onDelete) {
          callbacks.onDelete();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, rippleDeleteItems, clearSelection, callbacks]
  );

  // Editing: Alt+Arrow keys - nudge selected visual items by 1px
  useHotkeys(
    HOTKEYS.NUDGE_LEFT,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(-1, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    HOTKEYS.NUDGE_RIGHT,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(1, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    HOTKEYS.NUDGE_UP,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, -1);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    HOTKEYS.NUDGE_DOWN,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, 1);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  // Editing: Alt+Shift+Arrow keys - nudge selected visual items by 10px
  useHotkeys(
    HOTKEYS.NUDGE_LEFT_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(-10, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    HOTKEYS.NUDGE_RIGHT_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(10, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    HOTKEYS.NUDGE_UP_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, -10);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    HOTKEYS.NUDGE_DOWN_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, 10);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  // Editing: J - Join selected clips
  useHotkeys(
    HOTKEYS.JOIN_ITEMS,
    (event) => {
      if (selectedItemIds.length < 2) return;

      const selectedItems = selectedItemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((item): item is NonNullable<typeof item> => item !== undefined);

      if (selectedItems.length < 2) return;

      if (canJoinMultipleItems(selectedItems)) {
        event.preventDefault();
        joinItems(selectedItemIds);
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, items, joinItems]
  );

  // Editing: Alt+C - Split all items at gray playhead (or main playhead)
  useHotkeys(
    HOTKEYS.SPLIT_AT_PLAYHEAD,
    (event) => {
      event.preventDefault();
      const { previewFrame, currentFrame } = usePlaybackStore.getState();
      const splitFrame = previewFrame ?? currentFrame;

      const itemsToSplit = items.filter((item) => {
        if (item.type === 'composition') return false;
        const itemStart = item.from;
        const itemEnd = item.from + item.durationInFrames;
        return splitFrame > itemStart && splitFrame < itemEnd;
      });

      for (const item of itemsToSplit) {
        splitItem(item.id, splitFrame);
      }
    },
    HOTKEY_OPTIONS,
    [items, splitItem]
  );

  // Editing: Shift+F - Insert freeze frame at playhead
  useHotkeys(
    HOTKEYS.FREEZE_FRAME,
    (event) => {
      if (selectedItemIds.length !== 1) return;
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const selectedItem = items.find((i) => i.id === selectedItemIds[0]);
      if (!selectedItem || selectedItem.type !== 'video') return;

      // Check playhead is within item bounds
      if (currentFrame <= selectedItem.from || currentFrame >= selectedItem.from + selectedItem.durationInFrames) return;

      event.preventDefault();
      void insertFreezeFrame(selectedItem.id, currentFrame);
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, items]
  );

  // Keyframes: K - Add keyframe at playhead for selected items
  useHotkeys(
    HOTKEYS.ADD_KEYFRAME,
    (event) => {
      if (selectedItemIds.length === 0) return;

      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const addKeyframes = useTimelineStore.getState().addKeyframes;
      const storeItems = useTimelineStore.getState().items;
      const storeKeyframes = useTimelineStore.getState().keyframes;
      const storeTransitions = useTimelineStore.getState().transitions;
      const currentProject = useProjectStore.getState().currentProject;
      const canvas = {
        width: currentProject?.metadata.width ?? 1920,
        height: currentProject?.metadata.height ?? 1080,
        fps: currentProject?.metadata.fps ?? 30,
      };

      const keyframesToAdd: Array<{
        itemId: string;
        property: 'x' | 'y' | 'opacity' | 'rotation' | 'width' | 'height';
        frame: number;
        value: number;
        easing: 'linear';
      }> = [];

      let blockedByTransition = false;

      for (const itemId of selectedItemIds) {
        const item = storeItems.find((i) => i.id === itemId);
        if (!item) continue;

        const relativeFrame = currentFrame - item.from;
        if (relativeFrame < 0 || relativeFrame >= item.durationInFrames) continue;

        const transitionBlock = isFrameInTransitionRegion(relativeFrame, itemId, item, storeTransitions);
        if (transitionBlock) {
          blockedByTransition = true;
          continue;
        }

        const sourceDimensions = getSourceDimensions(item);
        const baseResolved = resolveTransform(item, canvas, sourceDimensions);
        const itemKeyframes = storeKeyframes.find((k) => k.itemId === itemId);
        const animated = itemKeyframes
          ? resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame)
          : baseResolved;

        keyframesToAdd.push(
          { itemId, property: 'x', frame: relativeFrame, value: animated.x, easing: 'linear' },
          { itemId, property: 'y', frame: relativeFrame, value: animated.y, easing: 'linear' },
          { itemId, property: 'opacity', frame: relativeFrame, value: animated.opacity, easing: 'linear' },
          { itemId, property: 'rotation', frame: relativeFrame, value: animated.rotation, easing: 'linear' },
          { itemId, property: 'width', frame: relativeFrame, value: animated.width, easing: 'linear' },
          { itemId, property: 'height', frame: relativeFrame, value: animated.height, easing: 'linear' }
        );
      }

      if (blockedByTransition && keyframesToAdd.length === 0) {
        toast.warning('Cannot add keyframes in transition region', {
          description: 'Move the playhead outside the transition area to add keyframes.',
          duration: 3000,
        });
        return;
      }

      if (keyframesToAdd.length > 0) {
        addKeyframes(keyframesToAdd);

        if (blockedByTransition) {
          toast.info('Some keyframes skipped', {
            description: 'Keyframes were not added to clips in transition regions.',
            duration: 2000,
          });
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds]
  );

  // Keyframes: Shift+K - Clear all keyframes for selected items (with confirmation)
  useHotkeys(
    HOTKEYS.CLEAR_KEYFRAMES,
    (event) => {
      if (selectedItemIds.length === 0) return;

      event.preventDefault();

      const storeKeyframes = useTimelineStore.getState().keyframes;
      const itemsWithKeyframes = selectedItemIds.filter((itemId) => {
        const itemKeyframes = storeKeyframes.find((k) => k.itemId === itemId);
        return itemKeyframes?.properties.some((p) => p.keyframes.length > 0);
      });

      if (itemsWithKeyframes.length === 0) return;

      useClearKeyframesDialogStore.getState().openClearAll(itemsWithKeyframes);
    },
    HOTKEY_OPTIONS,
    [selectedItemIds]
  );
}
