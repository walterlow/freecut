/**
 * Tool shortcuts: V (Select), C (Split at cursor), R (Rate Stretch).
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

  // Tool: C - Split hovered item at gray playhead (or main playhead)
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

  // Tool: Shift+C - Split selected clip at main playhead
  useHotkeys(
    HOTKEYS.SPLIT_SELECTED,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const { items, splitItem } = useTimelineStore.getState();
      const { selectedItemIds } = useSelectionStore.getState();

      let didSplit = false;
      for (const id of selectedItemIds) {
        const item = items.find((i) => i.id === id);
        if (item && item.type !== 'composition' && currentFrame > item.from && currentFrame < item.from + item.durationInFrames) {
          splitItem(item.id, currentFrame);
          didSplit = true;
        }
      }

      if (didSplit && callbacks.onSplit) {
        callbacks.onSplit();
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
}
