import { useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useZoomStore } from '../stores/zoom-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useClipboardStore } from '@/features/editor/stores/clipboard-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import { canJoinMultipleItems } from '@/utils/clip-utils';
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
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);
  const items = useTimelineStore((s) => s.items);
  const transitions = useTimelineStore((s) => s.transitions);
  const markers = useTimelineStore((s) => s.markers);
  const addMarker = useTimelineStore((s) => s.addMarker);
  const copyTransition = useClipboardStore((s) => s.copyTransition);
  const transitionClipboard = useClipboardStore((s) => s.transitionClipboard);

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
      const currentFrame = usePlaybackStore.getState().currentFrame;
      // Find the next edge after current frame
      const nextEdge = clipEdges.find((edge) => edge > currentFrame);
      if (nextEdge !== undefined) {
        setCurrentFrame(nextEdge);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, clipEdges]
  );

  // Navigation: Up - Jump to previous clip edge
  useHotkeys(
    HOTKEYS.PREVIOUS_EDGE,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
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
    [setCurrentFrame, clipEdges]
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

  // Markers: [ - Jump to previous marker
  useHotkeys(
    HOTKEYS.PREVIOUS_MARKER,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
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
    [setCurrentFrame, markers]
  );

  // Markers: ] - Jump to next marker
  useHotkeys(
    HOTKEYS.NEXT_MARKER,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      // Find the next marker after current frame
      const nextMarker = markers.find((m) => m.frame > currentFrame);
      if (nextMarker) {
        setCurrentFrame(nextMarker.frame);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame, markers]
  );

  // Keyframes: K - Add keyframe at playhead for selected items
  useHotkeys(
    HOTKEYS.ADD_KEYFRAME,
    (event) => {
      if (selectedItemIds.length === 0) return;

      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const addKeyframe = useTimelineStore.getState().addKeyframe;
      const storeItems = useTimelineStore.getState().items;
      const storeKeyframes = useTimelineStore.getState().keyframes;
      const currentProject = useProjectStore.getState().currentProject;
      const canvas = {
        width: currentProject?.metadata.width ?? 1920,
        height: currentProject?.metadata.height ?? 1080,
        fps: currentProject?.metadata.fps ?? 30,
      };

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

        // Add keyframes for each animatable property with current animated values
        addKeyframe(itemId, 'x', relativeFrame, animated.x, 'linear');
        addKeyframe(itemId, 'y', relativeFrame, animated.y, 'linear');
        addKeyframe(itemId, 'opacity', relativeFrame, animated.opacity, 'linear');
        addKeyframe(itemId, 'rotation', relativeFrame, animated.rotation, 'linear');
        addKeyframe(itemId, 'width', relativeFrame, animated.width, 'linear');
        addKeyframe(itemId, 'height', relativeFrame, animated.height, 'linear');
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds]
  );

  // Clipboard: Ctrl+C - Copy selected transition properties
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
      // TODO: Handle clip copy if needed
    },
    HOTKEY_OPTIONS,
    [selectedTransitionId, transitions, copyTransition]
  );

  // Clipboard: Ctrl+V - Paste transition properties to selected transition
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
      // TODO: Handle clip paste if needed
    },
    HOTKEY_OPTIONS,
    [selectedTransitionId, transitionClipboard, updateTransition]
  );
}
