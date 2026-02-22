/**
 * Tool shortcuts: V (Select), C (Razor), Shift+C (Split at cursor), R (Rate Stretch), N (Rolling Edit), B (Ripple Edit).
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts';

export function useToolShortcuts(callbacks: TimelineShortcutCallbacks) {
  const activeTool = useSelectionStore((s) => s.activeTool);
  const setActiveTool = useSelectionStore((s) => s.setActiveTool);

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

  // Tool: C - Toggle Razor/Cut Mode
  useHotkeys(
    HOTKEYS.RAZOR_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'razor' ? 'select' : 'razor');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: Shift+C - Split hovered item at gray playhead (or main playhead)
  useHotkeys(
    HOTKEYS.SPLIT_AT_CURSOR,
    (event) => {
      event.preventDefault();
      const { previewFrame, previewItemId, currentFrame } = usePlaybackStore.getState();
      const splitFrame = previewFrame ?? currentFrame;
      const { items, splitItem } = useTimelineStore.getState();

      // If hovering over a specific item, split only that item
      if (previewItemId) {
        const item = items.find((i) => i.id === previewItemId);
        if (item && item.type !== 'composition' && splitFrame > item.from && splitFrame < item.from + item.durationInFrames) {
          splitItem(item.id, splitFrame);
          if (callbacks.onSplit) {
            callbacks.onSplit();
          }
        }
      }
    },
    HOTKEY_OPTIONS,
    [callbacks]
  );

  // Tool: R - Toggle Rate Stretch Tool
  useHotkeys(
    HOTKEYS.RATE_STRETCH_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: N - Toggle Rolling Edit Tool
  useHotkeys(
    HOTKEYS.ROLLING_EDIT_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'rolling-edit' ? 'select' : 'rolling-edit');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: B - Toggle Ripple Edit Tool
  useHotkeys(
    HOTKEYS.RIPPLE_EDIT_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'ripple-edit' ? 'select' : 'ripple-edit');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );
}
