import { useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import { canJoinMultipleItems } from '@/utils/clip-utils';

export interface TimelineShortcutCallbacks {
  onPlay?: () => void;
  onPause?: () => void;
  onSplit?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
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
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const activeTool = useSelectionStore((s) => s.activeTool);
  const setActiveTool = useSelectionStore((s) => s.setActiveTool);
  const removeItems = useTimelineStore((s) => s.removeItems);
  const rippleDeleteItems = useTimelineStore((s) => s.rippleDeleteItems);
  const joinItems = useTimelineStore((s) => s.joinItems);
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);
  const items = useTimelineStore((s) => s.items);
  const markers = useTimelineStore((s) => s.markers);
  const addMarker = useTimelineStore((s) => s.addMarker);

  // Calculate all unique clip edges and marker positions (start and end frames) sorted ascending
  const clipEdges = useMemo(() => {
    const edges = new Set<number>();
    for (const item of items) {
      edges.add(item.from);
      edges.add(item.from + item.durationInFrames);
    }
    // Include marker positions
    for (const marker of markers) {
      edges.add(marker.frame);
    }
    return Array.from(edges).sort((a, b) => a - b);
  }, [items, markers]);

  // Playback: Space - Play/Pause (global shortcut)
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
    {
      ...HOTKEY_OPTIONS,
      enableOnFormTags: true, // Enable on all elements, including focused timeline items
      enabled: (keyboardEvent) => {
        const target = keyboardEvent.target as HTMLElement;
        // Only disable on actual text input fields, allow on buttons/divs
        return target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA';
      },
    },
    [togglePlayPause, isPlaying, callbacks]
  );

  // Navigation: Arrow Left - Previous frame
  useHotkeys(
    HOTKEYS.PREVIOUS_FRAME,
    (event) => {
      event.preventDefault();
      setCurrentFrame(Math.max(0, currentFrame - 1));
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, currentFrame]
  );

  // Navigation: Arrow Right - Next frame
  useHotkeys(
    HOTKEYS.NEXT_FRAME,
    (event) => {
      event.preventDefault();
      setCurrentFrame(currentFrame + 1);
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, currentFrame]
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

  // Navigation: End - Go to end
  useHotkeys(
    HOTKEYS.GO_TO_END,
    (event) => {
      event.preventDefault();
      // TODO: Calculate total timeline duration
      setCurrentFrame(900); // Placeholder
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );

  // Navigation: Down - Jump to next clip edge
  useHotkeys(
    HOTKEYS.NEXT_EDGE,
    (event) => {
      event.preventDefault();
      // Find the next edge after current frame
      const nextEdge = clipEdges.find((edge) => edge > currentFrame);
      if (nextEdge !== undefined) {
        setCurrentFrame(nextEdge);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, currentFrame, clipEdges]
  );

  // Navigation: Up - Jump to previous clip edge
  useHotkeys(
    HOTKEYS.PREVIOUS_EDGE,
    (event) => {
      event.preventDefault();
      // Find the previous edge before current frame
      // Iterate backwards through sorted edges
      let previousEdge: number | undefined;
      for (let i = clipEdges.length - 1; i >= 0; i--) {
        if (clipEdges[i] < currentFrame) {
          previousEdge = clipEdges[i];
          break;
        }
      }
      if (previousEdge !== undefined) {
        setCurrentFrame(previousEdge);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, currentFrame, clipEdges]
  );

  // Editing: Delete - Delete selected items
  useHotkeys(
    HOTKEYS.DELETE_SELECTED,
    (event) => {
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        removeItems(selectedItemIds);
        if (callbacks.onDelete) {
          callbacks.onDelete();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, removeItems, callbacks]
  );

  // Editing: Backspace - Delete selected items (alternative)
  useHotkeys(
    HOTKEYS.DELETE_SELECTED_ALT,
    (event) => {
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        removeItems(selectedItemIds);
        if (callbacks.onDelete) {
          callbacks.onDelete();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, removeItems, callbacks]
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

  // History: Cmd/Ctrl+Z - Undo
  useHotkeys(
    HOTKEYS.UNDO,
    (event) => {
      event.preventDefault();
      useTimelineStore.temporal.getState().undo();
      if (callbacks.onUndo) {
        callbacks.onUndo();
      }
    },
    HOTKEY_OPTIONS,
    [callbacks]
  );

  // History: Cmd/Ctrl+Shift+Z - Redo
  useHotkeys(
    HOTKEYS.REDO,
    (event) => {
      event.preventDefault();
      useTimelineStore.temporal.getState().redo();
      if (callbacks.onRedo) {
        callbacks.onRedo();
      }
    },
    HOTKEY_OPTIONS,
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

  // Markers: M - Add marker at playhead
  useHotkeys(
    HOTKEYS.ADD_MARKER,
    (event) => {
      event.preventDefault();
      addMarker(currentFrame);
    },
    HOTKEY_OPTIONS,
    [addMarker, currentFrame]
  );

  // Markers: [ - Jump to previous marker
  useHotkeys(
    HOTKEYS.PREVIOUS_MARKER,
    (event) => {
      event.preventDefault();
      // Find the previous marker before current frame
      let previousMarker: number | undefined;
      for (let i = markers.length - 1; i >= 0; i--) {
        const marker = markers[i];
        if (marker && marker.frame < currentFrame) {
          previousMarker = marker.frame;
          break;
        }
      }
      if (previousMarker !== undefined) {
        setCurrentFrame(previousMarker);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, currentFrame, markers]
  );

  // Markers: ] - Jump to next marker
  useHotkeys(
    HOTKEYS.NEXT_MARKER,
    (event) => {
      event.preventDefault();
      // Find the next marker after current frame
      const nextMarker = markers.find((m) => m.frame > currentFrame);
      if (nextMarker) {
        setCurrentFrame(nextMarker.frame);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, currentFrame, markers]
  );
}
