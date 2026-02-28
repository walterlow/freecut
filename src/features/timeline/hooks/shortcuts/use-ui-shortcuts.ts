/**
 * UI shortcuts: S (snap toggle), Z (zoom to fit), Shift+Z (zoom to 100%), Undo/Redo.
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { useTimelineStore } from '../../stores/timeline-store';
import { useZoomStore, getZoomTo100Handler } from '../../stores/zoom-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts';

export function useUIShortcuts(callbacks: TimelineShortcutCallbacks) {
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);

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
    {
      ...HOTKEY_OPTIONS,
      enableOnFormTags: true,
    },
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
    {
      ...HOTKEY_OPTIONS,
      enableOnFormTags: true,
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
      if (callbacks.onZoomToFit) {
        callbacks.onZoomToFit();
        return;
      }
      const container = document.querySelector('.timeline-container');
      if (!container) return;

      const fps = useTimelineStore.getState().fps;
      const items = useTimelineStore.getState().items;
      const containerWidth = container.clientWidth;

      const contentDuration = Math.max(10, items.reduce((max, item) => {
        const itemEnd = (item.from + item.durationInFrames) / fps;
        return Math.max(max, itemEnd);
      }, 0));

      useZoomStore.getState().zoomToFit(containerWidth, contentDuration);

      (container as HTMLElement).scrollLeft = 0;
    },
    HOTKEY_OPTIONS,
    [callbacks]
  );

  // Zoom: Shift+Z - Zoom to 100% centered on cursor (or playhead if cursor not on timeline)
  useHotkeys(
    HOTKEYS.ZOOM_TO_100,
    (event) => {
      event.preventDefault();
      const { currentFrame, previewFrame } = usePlaybackStore.getState();
      const targetFrame = previewFrame ?? currentFrame;

      const handler = getZoomTo100Handler();
      if (handler) {
        handler(targetFrame);
      }
    },
    HOTKEY_OPTIONS,
    []
  );
}
