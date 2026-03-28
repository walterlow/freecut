/**
 * UI shortcuts: S (snap toggle), Cmd/Ctrl+=/- (zoom), \\ (zoom to fit), Shift+\\ or Cmd/Ctrl+0 (zoom to 100%), Undo/Redo.
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { useTimelineStore } from '../../stores/timeline-store';
import { useZoomStore, getZoomTo100Handler } from '../../stores/zoom-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts';
import { useResolvedHotkeys } from '@/features/timeline/deps/settings';

export function useUIShortcuts(callbacks: TimelineShortcutCallbacks) {
  const hotkeys = useResolvedHotkeys();
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);
  const zoomIn = useZoomStore((s) => s.zoomIn);
  const zoomOut = useZoomStore((s) => s.zoomOut);

  // History: Cmd/Ctrl+Z - Undo
  useHotkeys(
    hotkeys.UNDO,
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
    hotkeys.REDO,
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
    hotkeys.TOGGLE_SNAP,
    (event) => {
      event.preventDefault();
      toggleSnap();
    },
    HOTKEY_OPTIONS,
    [toggleSnap]
  );

  const zoomHotkeyOptions = { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } };

  // Zoom: Cmd/Ctrl+Equals - Zoom in
  useHotkeys(
    hotkeys.ZOOM_IN,
    (event) => {
      event.preventDefault();
      zoomIn();
    },
    zoomHotkeyOptions,
    [zoomIn]
  );

  // Zoom: Cmd/Ctrl+Minus - Zoom out
  useHotkeys(
    hotkeys.ZOOM_OUT,
    (event) => {
      event.preventDefault();
      zoomOut();
    },
    zoomHotkeyOptions,
    [zoomOut]
  );

  // Zoom: Backslash - Zoom to Fit
  useHotkeys(
    hotkeys.ZOOM_TO_FIT,
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

  // Zoom: Shift+Backslash - Zoom to 100% centered on cursor (or playhead if cursor not on timeline)
  useHotkeys(
    hotkeys.ZOOM_TO_100,
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

  // Zoom: Cmd/Ctrl+0 - Reset timeline zoom to 100%
  useHotkeys(
    hotkeys.ZOOM_TO_100_ALT,
    (event) => {
      event.preventDefault();
      const { currentFrame, previewFrame } = usePlaybackStore.getState();
      const targetFrame = previewFrame ?? currentFrame;

      const handler = getZoomTo100Handler();
      if (handler) {
        handler(targetFrame);
      }
    },
    zoomHotkeyOptions,
    []
  );
}
