/**
 * Tool shortcuts: V (Select), C (Razor), Shift+C (Split at cursor), R (Rate Stretch), N (Rolling Edit), B (Ripple Edit), Y (Slip), U (Slide).
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts';
import { useResolvedHotkeys } from '@/features/timeline/deps/settings';

export function useToolShortcuts(callbacks: TimelineShortcutCallbacks) {
  const hotkeys = useResolvedHotkeys();
  const activeTool = useSelectionStore((s) => s.activeTool);
  const setActiveTool = useSelectionStore((s) => s.setActiveTool);

  // Tool: V - Selection Tool
  useHotkeys(
    hotkeys.SELECTION_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool('select');
    },
    HOTKEY_OPTIONS,
    [setActiveTool]
  );

  // Tool: C - Toggle Razor/Cut Mode
  useHotkeys(
    hotkeys.RAZOR_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'razor' ? 'select' : 'razor');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: Shift+C - Split hovered item at gray playhead (or main playhead)
  useHotkeys(
    hotkeys.SPLIT_AT_CURSOR,
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
    hotkeys.RATE_STRETCH_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: N - Toggle Rolling Edit Tool
  useHotkeys(
    hotkeys.ROLLING_EDIT_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'rolling-edit' ? 'select' : 'rolling-edit');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: B - Toggle Ripple Edit Tool
  useHotkeys(
    hotkeys.RIPPLE_EDIT_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'ripple-edit' ? 'select' : 'ripple-edit');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: Y - Toggle Slip Tool
  useHotkeys(
    hotkeys.SLIP_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'slip' ? 'select' : 'slip');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );

  // Tool: U - Toggle Slide Tool
  useHotkeys(
    hotkeys.SLIDE_TOOL,
    (event) => {
      event.preventDefault();
      setActiveTool(activeTool === 'slide' ? 'select' : 'slide');
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool]
  );
}
