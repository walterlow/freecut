import { useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useZoomStore } from '../stores/zoom-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useClipboardStore } from '@/features/editor/stores/clipboard-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import { canJoinMultipleItems } from '@/features/timeline/utils/clip-utils';
import { resolveTransform, getSourceDimensions } from '@/lib/remotion/utils/transform-resolver';
import { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';
import type { Transition } from '@/types/transition';

export interface TimelineShortcutCallbacks {
  onPlay?: () => void;
  onPause?: () => void;
  onSplit?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onZoomToFit?: () => void;
}

/**
 * Timeline keyboard shortcuts hook
 *
 * Handles all timeline-specific keyboard shortcuts using react-hotkeys-hook:
 * - Space/K: Play/Pause
 * - Arrow Left/Right (J/L): Previous/Next frame
 * - Home/End: Go to start/end
 * - Delete/Backspace: Delete selected items
 * - C: Split item at playhead
 * - Cmd/Ctrl+Z: Undo
 * - Cmd/Ctrl+Shift+Z: Redo
 *
 * Note: Zoom is handled via Ctrl+Scroll only (see TimelineContent component)
 */
export function useTimelineShortcuts(callbacks: TimelineShortcutCallbacks = {}) {
  // Access stores with granular selectors (performance optimization)
  // NOTE: Don't subscribe to currentFrame - read from store in callbacks to prevent re-renders
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const activeTool = useSelectionStore((s) => s.activeTool);
  const setActiveTool = useSelectionStore((s) => s.setActiveTool);
  const removeItems = useTimelineStore((s) => s.removeItems);
  const removeMarker = useTimelineStore((s) => s.removeMarker);
  const removeTransition = useTimelineStore((s) => s.removeTransition);
  const updateTransition = useTimelineStore((s) => s.updateTransition);
  const rippleDeleteItems = useTimelineStore((s) => s.rippleDeleteItems);
  const joinItems = useTimelineStore((s) => s.joinItems);
  const splitItem = useTimelineStore((s) => s.splitItem);
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);
  const items = useTimelineStore((s) => s.items);
  const transitions = useTimelineStore((s) => s.transitions);
  const markers = useTimelineStore((s) => s.markers);
  const addMarker = useTimelineStore((s) => s.addMarker);
  const copyTransition = useClipboardStore((s) => s.copyTransition);
  const transitionClipboard = useClipboardStore((s) => s.transitionClipboard);
  const copyItems = useClipboardStore((s) => s.copyItems);
  const itemsClipboard = useClipboardStore((s) => s.itemsClipboard);
  const addItem = useTimelineStore((s) => s.addItem);
  const tracks = useTimelineStore((s) => s.tracks);
  const setSelectedItemIds = useSelectionStore((s) => s.setSelectedItemIds);
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);

  // Calculate all snap points: clip edges (start/end frames) and marker positions
  const snapPoints = useMemo(() => {
    const points = new Set<number>();
    // Add clip edges
    for (const item of items) {
      points.add(item.from);
      points.add(item.from + item.durationInFrames);
    }
    // Add marker positions
    for (const marker of markers) {
      points.add(marker.frame);
    }
    return Array.from(points).sort((a, b) => a - b);
  }, [items, markers]);

  // Playback: Space - Play/Pause (global shortcut)
  // Uses default HOTKEY_OPTIONS which disables in form tags (inputs/textareas)
  useHotkeys(
    HOTKEYS.PLAY_PAUSE,
    (event) => {
      event.preventDefault();
      togglePlayPause();
      if (isPlaying && callbacks.onPause) {
        callbacks.onPause();
      } else if (!isPlaying && callbacks.onPlay) {
        callbacks.onPlay();
      }
    },
    HOTKEY_OPTIONS,
    [togglePlayPause, isPlaying, callbacks]
  );

  // Navigation: Arrow Left - Previous frame
  useHotkeys(
    HOTKEYS.PREVIOUS_FRAME,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      setCurrentFrame(Math.max(0, currentFrame - 1));
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );

  // Navigation: Arrow Right - Next frame
  useHotkeys(
    HOTKEYS.NEXT_FRAME,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      setCurrentFrame(currentFrame + 1);
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );

  // Navigation: Home - Go to start
  useHotkeys(
    HOTKEYS.GO_TO_START,
    (event) => {
      event.preventDefault();
      setCurrentFrame(0);
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );

  // Navigation: End - Go to end of timeline (last frame of last item)
  useHotkeys(
    HOTKEYS.GO_TO_END,
    (event) => {
      event.preventDefault();
      // Calculate the last frame from all items
      const lastFrame = items.reduce((max, item) => {
        const itemEnd = item.from + item.durationInFrames;
        return Math.max(max, itemEnd);
      }, 0);
      setCurrentFrame(lastFrame);
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, items]
  );

  // Navigation: Down - Jump to next snap point (clip edge or marker)
  useHotkeys(
    HOTKEYS.NEXT_SNAP_POINT,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      // Find the next edge after current frame
      const nextEdge = snapPoints.find((edge) => edge > currentFrame);
      if (nextEdge !== undefined) {
        setCurrentFrame(nextEdge);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, snapPoints]
  );

  // Navigation: Up - Jump to previous snap point (clip edge or marker)
  useHotkeys(
    HOTKEYS.PREVIOUS_SNAP_POINT,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      // Find the previous edge before current frame
      // Iterate backwards through sorted edges
      let previousEdge: number | undefined;
      for (let i = snapPoints.length - 1; i >= 0; i--) {
        if (snapPoints[i] < currentFrame) {
          previousEdge = snapPoints[i];
          break;
        }
      }
      if (previousEdge !== undefined) {
        setCurrentFrame(previousEdge);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, snapPoints]
  );

  // Editing: Delete - Delete selected items, marker, or transition
  useHotkeys(
    HOTKEYS.DELETE_SELECTED,
    (event) => {
      // Delete selected transition
      if (selectedTransitionId) {
        event.preventDefault();
        removeTransition(selectedTransitionId);
        clearSelection();
        return;
      }
      // Delete selected marker
      if (selectedMarkerId) {
        event.preventDefault();
        removeMarker(selectedMarkerId);
        clearSelection();
        return;
      }
      // Delete selected items
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
      // Delete selected transition
      if (selectedTransitionId) {
        event.preventDefault();
        removeTransition(selectedTransitionId);
        clearSelection();
        return;
      }
      // Delete selected marker
      if (selectedMarkerId) {
        event.preventDefault();
        removeMarker(selectedMarkerId);
        clearSelection();
        return;
      }
      // Delete selected items
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

  // Editing: J - Join selected clips (if they form a contiguous joinable chain)
  useHotkeys(
    HOTKEYS.JOIN_ITEMS,
    (event) => {
      // Need at least 2 items selected
      if (selectedItemIds.length < 2) return;

      // Get selected items
      const selectedItems = selectedItemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((item): item is NonNullable<typeof item> => item !== undefined);

      if (selectedItems.length < 2) return;

      // Check if all selected items can be joined
      if (canJoinMultipleItems(selectedItems)) {
        event.preventDefault();
        joinItems(selectedItemIds);
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, items, joinItems]
  );

  // Editing: Alt+C - Split all items at playhead
  useHotkeys(
    HOTKEYS.SPLIT_AT_PLAYHEAD,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;

      // Find all items that span the current playhead position
      const itemsToSplit = items.filter((item) => {
        const itemStart = item.from;
        const itemEnd = item.from + item.durationInFrames;
        // Item must contain the playhead (not at edges)
        return currentFrame > itemStart && currentFrame < itemEnd;
      });

      // Split each item at the playhead
      for (const item of itemsToSplit) {
        splitItem(item.id, currentFrame);
      }
    },
    HOTKEY_OPTIONS,
    [items, splitItem]
  );

  // Selection: Escape - Deselect all items
  useHotkeys(
    HOTKEYS.DESELECT_ALL,
    (event) => {
      event.preventDefault();
      clearSelection();
    },
    HOTKEY_OPTIONS,
    [clearSelection]
  );

  // Tool: V - Selection Tool
  useHotkeys(
    HOTKEYS.SELECTION_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool('select');
    },
    HOTKEY_OPTIONS,
    [setActiveTool]
  );

  // Tool: C - Toggle Razor Tool
  useHotkeys(
    HOTKEYS.RAZOR_TOOL,
    (event) => {
      event.preventDefault();
      // Toggle razor tool
      setActiveTool(activeTool === 'razor' ? 'select' : 'razor');
      if (callbacks.onSplit) {
        callbacks.onSplit();
      }
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool, callbacks]
  );

  // Tool: R - Toggle Rate Stretch Tool
  useHotkeys(
    HOTKEYS.RATE_STRETCH_TOOL,
    (event) => {
      event.preventDefault();
      // Toggle rate stretch tool
      setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // History: Cmd/Ctrl+Z - Undo (enabled even on form elements like sliders)
  useHotkeys(
    HOTKEYS.UNDO,
    (event) => {
      event.preventDefault();
      useTimelineStore.temporal.getState().undo();
      if (callbacks.onUndo) {
        callbacks.onUndo();
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enableOnFormTags: true, // Allow undo even when focused on sliders/inputs
    },
    [callbacks]
  );

  // History: Cmd/Ctrl+Shift+Z - Redo (enabled even on form elements like sliders)
  useHotkeys(
    HOTKEYS.REDO,
    (event) => {
      event.preventDefault();
      useTimelineStore.temporal.getState().redo();
      if (callbacks.onRedo) {
        callbacks.onRedo();
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enableOnFormTags: true, // Allow redo even when focused on sliders/inputs
    },
    [callbacks]
  );

  // UI: S - Toggle Snap
  useHotkeys(
    HOTKEYS.TOGGLE_SNAP,
    (event) => {
      event.preventDefault();
      toggleSnap();
    },
    HOTKEY_OPTIONS,
    [toggleSnap]
  );

  // Zoom: Z - Zoom to Fit
  useHotkeys(
    HOTKEYS.ZOOM_TO_FIT,
    (event) => {
      event.preventDefault();
      // Try the callback first (provides playhead centering via TimelineContent)
      if (callbacks.onZoomToFit) {
        callbacks.onZoomToFit();
        return;
      }
      // Fallback: calculate and apply zoom directly
      const container = document.querySelector('.timeline-container');
      if (!container) return;

      const fps = useTimelineStore.getState().fps;
      const items = useTimelineStore.getState().items;
      const containerWidth = container.clientWidth;

      // Calculate content duration from items
      const contentDuration = Math.max(10, items.reduce((max, item) => {
        const itemEnd = (item.from + item.durationInFrames) / fps;
        return Math.max(max, itemEnd);
      }, 0));

      useZoomStore.getState().zoomToFit(containerWidth, contentDuration);

      // Reset scroll to start
      (container as HTMLElement).scrollLeft = 0;
    },
    HOTKEY_OPTIONS,
    [callbacks]
  );

  // Markers: M - Add marker at playhead
  useHotkeys(
    HOTKEYS.ADD_MARKER,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      addMarker(currentFrame);
    },
    HOTKEY_OPTIONS,
    [addMarker]
  );

  // Markers: Shift+M - Remove selected marker
  useHotkeys(
    HOTKEYS.REMOVE_MARKER,
    (event) => {
      event.preventDefault();
      if (selectedMarkerId) {
        removeMarker(selectedMarkerId);
        clearSelection();
      }
    },
    HOTKEY_OPTIONS,
    [selectedMarkerId, removeMarker, clearSelection]
  );

  // Markers: [ - Jump to previous marker
  useHotkeys(
    HOTKEYS.PREVIOUS_MARKER,
    (event) => {
      event.preventDefault();
      // Read markers directly from store to get latest state
      const currentMarkers = useTimelineStore.getState().markers;
      if (currentMarkers.length === 0) return;
      const currentFrame = usePlaybackStore.getState().currentFrame;
      // Find the closest marker before current frame (markers may not be sorted)
      let previousFrame: number | undefined;
      for (const marker of currentMarkers) {
        if (marker.frame < currentFrame) {
          if (previousFrame === undefined || marker.frame > previousFrame) {
            previousFrame = marker.frame;
          }
        }
      }
      if (previousFrame !== undefined) {
        setCurrentFrame(previousFrame);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );

  // Markers: ] - Jump to next marker
  useHotkeys(
    HOTKEYS.NEXT_MARKER,
    (event) => {
      event.preventDefault();
      // Read markers directly from store to get latest state
      const currentMarkers = useTimelineStore.getState().markers;
      if (currentMarkers.length === 0) return;
      const currentFrame = usePlaybackStore.getState().currentFrame;
      // Find the closest marker after current frame (markers may not be sorted)
      let nextFrame: number | undefined;
      for (const marker of currentMarkers) {
        if (marker.frame > currentFrame) {
          if (nextFrame === undefined || marker.frame < nextFrame) {
            nextFrame = marker.frame;
          }
        }
      }
      if (nextFrame !== undefined) {
        setCurrentFrame(nextFrame);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
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
      const currentProject = useProjectStore.getState().currentProject;
      const canvas = {
        width: currentProject?.metadata.width ?? 1920,
        height: currentProject?.metadata.height ?? 1080,
        fps: currentProject?.metadata.fps ?? 30,
      };

      // Collect all keyframes to add in a single batch
      const keyframesToAdd: Array<{
        itemId: string;
        property: 'x' | 'y' | 'opacity' | 'rotation' | 'width' | 'height';
        frame: number;
        value: number;
        easing: 'linear';
      }> = [];

      // Add keyframes for all transform properties of selected items
      for (const itemId of selectedItemIds) {
        const item = storeItems.find((i) => i.id === itemId);
        if (!item) continue;

        // Calculate frame relative to item start
        const relativeFrame = currentFrame - item.from;

        // Only add keyframes if playhead is within the item
        if (relativeFrame < 0 || relativeFrame >= item.durationInFrames) continue;

        // Get the current animated values (what the user sees in preview)
        const sourceDimensions = getSourceDimensions(item);
        const baseResolved = resolveTransform(item, canvas, sourceDimensions);
        const itemKeyframes = storeKeyframes.find((k) => k.itemId === itemId);
        const animated = itemKeyframes
          ? resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame)
          : baseResolved;

        // Collect keyframes for each animatable property with current animated values
        keyframesToAdd.push(
          { itemId, property: 'x', frame: relativeFrame, value: animated.x, easing: 'linear' },
          { itemId, property: 'y', frame: relativeFrame, value: animated.y, easing: 'linear' },
          { itemId, property: 'opacity', frame: relativeFrame, value: animated.opacity, easing: 'linear' },
          { itemId, property: 'rotation', frame: relativeFrame, value: animated.rotation, easing: 'linear' },
          { itemId, property: 'width', frame: relativeFrame, value: animated.width, easing: 'linear' },
          { itemId, property: 'height', frame: relativeFrame, value: animated.height, easing: 'linear' }
        );
      }

      // Add all keyframes in a single batch (single undo operation)
      if (keyframesToAdd.length > 0) {
        addKeyframes(keyframesToAdd);
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds]
  );

  // Clipboard: Ctrl+C - Copy selected transition properties or timeline items
  useHotkeys(
    HOTKEYS.COPY,
    (event) => {
      // Copy transition if selected
      if (selectedTransitionId) {
        event.preventDefault();
        const transition = transitions.find(
          (t: Transition) => t.id === selectedTransitionId
        );
        if (transition) {
          copyTransition({
            presentation: transition.presentation,
            direction: transition.direction,
            timing: transition.timing,
            durationInFrames: transition.durationInFrames,
          });
        }
        return;
      }
      // Copy selected items
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'copy');
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedTransitionId, transitions, copyTransition, selectedItemIds, items, copyItems]
  );

  // Clipboard: Ctrl+X - Cut selected items
  useHotkeys(
    HOTKEYS.CUT,
    (event) => {
      // Cut selected items (copy with cut flag)
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'cut');
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, items, copyItems]
  );

  // Clipboard: Ctrl+V - Paste transition properties or timeline items
  useHotkeys(
    HOTKEYS.PASTE,
    (event) => {
      // Paste to transition if selected and clipboard has transition data
      if (selectedTransitionId && transitionClipboard) {
        event.preventDefault();
        updateTransition(selectedTransitionId, {
          presentation: transitionClipboard.presentation,
          direction: transitionClipboard.direction,
          timing: transitionClipboard.timing,
          durationInFrames: transitionClipboard.durationInFrames,
        });
        return;
      }
      // Paste items from clipboard
      if (itemsClipboard && itemsClipboard.items.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const storeItems = useTimelineStore.getState().items;
        const newItemIds: string[] = [];

        // Helper: find next available space on a track
        const findNextAvailableSpace = (
          trackId: string,
          startFrame: number,
          duration: number
        ): number => {
          // Get all items on this track, sorted by start frame
          const trackItems = storeItems
            .filter((item) => item.trackId === trackId)
            .sort((a, b) => a.from - b.from);

          let candidateFrame = startFrame;

          for (const item of trackItems) {
            const itemEnd = item.from + item.durationInFrames;
            // Check if candidate position overlaps with this item
            if (candidateFrame < itemEnd && candidateFrame + duration > item.from) {
              // Overlap detected, try after this item
              candidateFrame = itemEnd;
            }
          }

          return candidateFrame;
        };

        // Helper: check if space is available at position
        const hasSpaceAt = (
          trackId: string,
          startFrame: number,
          duration: number
        ): boolean => {
          const trackItems = storeItems.filter((item) => item.trackId === trackId);
          for (const item of trackItems) {
            const itemEnd = item.from + item.durationInFrames;
            // Check overlap
            if (startFrame < itemEnd && startFrame + duration > item.from) {
              return false;
            }
          }
          return true;
        };

        // Create new items at playhead position on active track
        for (const itemData of itemsClipboard.items) {
          const newId = crypto.randomUUID();
          newItemIds.push(newId);

          // 1. First check active track, then original track, then first track
          let targetTrackId = activeTrackId;
          if (!targetTrackId || !tracks.some((t) => t.id === targetTrackId)) {
            targetTrackId = itemData.trackId;
          }
          const trackExists = tracks.some((t) => t.id === targetTrackId);
          if (!trackExists && tracks.length > 0) {
            targetTrackId = tracks[0].id;
          }

          // 2. Calculate position: start at playhead
          const desiredFrom = currentFrame;
          const duration = itemData.durationInFrames;

          // 3. Check if space available at playhead, if not find next available space
          let newFrom: number;
          if (hasSpaceAt(targetTrackId, desiredFrom, duration)) {
            newFrom = desiredFrom;
          } else {
            newFrom = findNextAvailableSpace(targetTrackId, desiredFrom, duration);
          }

          // Create new item with new ID and position
          const newItem = {
            ...itemData,
            id: newId,
            from: newFrom,
            trackId: targetTrackId,
            // Clear originId to treat as new item lineage
            originId: undefined,
          };

          addItem(newItem as Parameters<typeof addItem>[0]);
        }

        // Select the newly pasted items
        if (newItemIds.length > 0) {
          setSelectedItemIds(newItemIds);
        }

        // For cut operation, remove original items after successful paste
        if (itemsClipboard.copyType === 'cut') {
          removeItems(itemsClipboard.originalIds);
          // Clear clipboard after cut-paste to prevent double paste
          useClipboardStore.getState().clearItemsClipboard();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedTransitionId, transitionClipboard, updateTransition, itemsClipboard, tracks, addItem, setSelectedItemIds, removeItems, activeTrackId]
  );
}
