/**
 * Editing shortcuts: Delete, Ripple Delete, Join, Split, Keyframes.
 */

import { useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/app/state/editor';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import { canJoinMultipleItems } from '@/features/timeline/utils/clip-utils';
import { canLinkSelection, hasLinkedItems } from '@/features/timeline/utils/linked-items';
import { insertFreezeFrame, linkItems, splitAllItemsAtFrame, unlinkItems } from '../../stores/actions/item-actions';
import type { TransformProperties } from '@/types/transform';
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts';
import { useClearKeyframesDialogStore } from '@/app/state/clear-keyframes-dialog';
import { useResolvedHotkeys } from '@/features/timeline/deps/settings';
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store';

export function useEditingShortcuts(callbacks: TimelineShortcutCallbacks) {
  const hotkeys = useResolvedHotkeys();
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);
  const removeItems = useTimelineStore((s) => s.removeItems);
  const removeMarker = useTimelineStore((s) => s.removeMarker);
  const removeTransition = useTimelineStore((s) => s.removeTransition);
  const rippleDeleteItems = useTimelineStore((s) => s.rippleDeleteItems);
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap);
  const joinItems = useTimelineStore((s) => s.joinItems);
  const items = useTimelineStore((s) => s.items);
  const keyframeEditorOpen = useEditorStore((s) => s.keyframeEditorOpen);
  const keyframeEditorShortcutScopeActive = useEditorStore((s) => s.keyframeEditorShortcutScopeActive);
  const toggleLinkedSelectionEnabled = useEditorStore((s) => s.toggleLinkedSelectionEnabled);
  const keyframeSelectionOwnsDeleteShortcut = keyframeEditorShortcutScopeActive
    || (keyframeEditorOpen && selectedKeyframes.length > 0);

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
    hotkeys.DELETE_SELECTED,
    (event) => {
      if (keyframeSelectionOwnsDeleteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
    [keyframeSelectionOwnsDeleteShortcut, selectedItemIds, selectedMarkerId, selectedTransitionId, removeItems, removeMarker, removeTransition, clearSelection, callbacks]
  );

  // Editing: Backspace - Delete selected items, marker, or transition (alternative)
  useHotkeys(
    hotkeys.DELETE_SELECTED_ALT,
    (event) => {
      if (keyframeSelectionOwnsDeleteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
    [keyframeSelectionOwnsDeleteShortcut, selectedItemIds, selectedMarkerId, selectedTransitionId, removeItems, removeMarker, removeTransition, clearSelection, callbacks]
  );

  // Editing: Ctrl+Delete - Ripple delete selected items (delete + close gap)
  useHotkeys(
    hotkeys.RIPPLE_DELETE,
    (event) => {
      if (keyframeSelectionOwnsDeleteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
    [keyframeSelectionOwnsDeleteShortcut, selectedItemIds, rippleDeleteItems, clearSelection, callbacks]
  );

  // Editing: Ctrl+Backspace - Ripple delete selected items (alternative)
  useHotkeys(
    hotkeys.RIPPLE_DELETE_ALT,
    (event) => {
      if (keyframeSelectionOwnsDeleteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
    [keyframeSelectionOwnsDeleteShortcut, selectedItemIds, rippleDeleteItems, clearSelection, callbacks]
  );

  // Editing: Shift+Arrow keys - nudge selected visual items by 1px
  useHotkeys(
    hotkeys.NUDGE_LEFT,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(-1, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    hotkeys.NUDGE_RIGHT,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(1, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    hotkeys.NUDGE_UP,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, -1);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    hotkeys.NUDGE_DOWN,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, 1);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  // Editing: Cmd/Ctrl+Shift+Arrow keys - nudge selected visual items by 10px
  useHotkeys(
    hotkeys.NUDGE_LEFT_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(-10, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    hotkeys.NUDGE_RIGHT_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(10, 0);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    hotkeys.NUDGE_UP_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, -10);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  useHotkeys(
    hotkeys.NUDGE_DOWN_LARGE,
    (event) => {
      event.preventDefault();
      nudgeSelectedVisualItems(0, 10);
    },
    HOTKEY_OPTIONS,
    [nudgeSelectedVisualItems]
  );

  // Editing: Shift+J - Join selected clips
  useHotkeys(
    hotkeys.JOIN_ITEMS,
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

  useHotkeys(
    hotkeys.LINK_AUDIO_VIDEO,
    (event) => {
      if (selectedItemIds.length < 2) return;
      if (!canLinkSelection(items, selectedItemIds)) return;

      event.preventDefault();
      linkItems(selectedItemIds);
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, items]
  );

  useHotkeys(
    hotkeys.UNLINK_AUDIO_VIDEO,
    (event) => {
      if (selectedItemIds.length === 0) return;
      if (!selectedItemIds.some((id) => hasLinkedItems(items, id))) return;

      event.preventDefault();
      unlinkItems(selectedItemIds);
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, items]
  );

  useHotkeys(
    hotkeys.TOGGLE_LINKED_SELECTION,
    (event) => {
      event.preventDefault();
      toggleLinkedSelectionEnabled();
    },
    HOTKEY_OPTIONS,
    [toggleLinkedSelectionEnabled]
  );

  const splitAtPlayhead = useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    const { previewFrame, currentFrame } = usePlaybackStore.getState();
    const splitFrame = previewFrame ?? currentFrame;
    splitAllItemsAtFrame(splitFrame);
  }, []);

  // Editing: Cmd/Ctrl+K - Split all items at gray playhead (or main playhead)
  useHotkeys(
    hotkeys.SPLIT_AT_PLAYHEAD,
    splitAtPlayhead,
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [splitAtPlayhead]
  );

  useHotkeys(
    hotkeys.SPLIT_AT_PLAYHEAD_ALT,
    splitAtPlayhead,
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [splitAtPlayhead]
  );

  // Editing: Shift+F - Insert freeze frame at playhead
  useHotkeys(
    hotkeys.FREEZE_FRAME,
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

  // Keyframes: Shift+A - Clear all keyframes for selected items (with confirmation)
  useHotkeys(
    hotkeys.CLEAR_KEYFRAMES,
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
