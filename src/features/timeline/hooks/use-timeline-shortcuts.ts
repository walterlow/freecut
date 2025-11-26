import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';

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
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);

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

  // Navigation: J - Previous frame (alternative)
  useHotkeys(
    HOTKEYS.PREVIOUS_FRAME_ALT,
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

  // Navigation: L - Next frame (alternative)
  useHotkeys(
    HOTKEYS.NEXT_FRAME_ALT,
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
}
