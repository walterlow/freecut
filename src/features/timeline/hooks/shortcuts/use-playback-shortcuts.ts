/**
 * Playback & Navigation shortcuts: Space, Arrow Left/Right, Home/End, Up/Down snap points.
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/shared/state/playback';
import { useItemsStore } from '../../stores/items-store';
import { useMarkersStore } from '../../stores/markers-store';
import { useTransitionsStore } from '../../stores/transitions-store';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts';
import { useSourcePlayerStore } from '@/shared/state/source-player';
import { getFilteredItemSnapEdges } from '../../utils/timeline-snap-utils';
import { getVisibleTrackIds } from '../../utils/group-utils';

/** Compute snap points on-demand from current store state (avoids reactive subscriptions). */
function getSnapPoints(): number[] {
  const items = useItemsStore.getState().items;
  const markers = useMarkersStore.getState().markers;
  const transitions = useTransitionsStore.getState().transitions;
  const tracks = useItemsStore.getState().tracks;
  const visibleTrackIds = getVisibleTrackIds(tracks);
  const points = new Set<number>();

  for (const edge of getFilteredItemSnapEdges(items, transitions, visibleTrackIds)) {
    points.add(edge.frame);
  }
  for (const marker of markers) {
    points.add(marker.frame);
  }
  return Array.from(points).sort((a, b) => a - b);
}

export function usePlaybackShortcuts(
  callbacks: TimelineShortcutCallbacks,
) {
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  // Playback: Space - Play/Pause
  useHotkeys(
    HOTKEYS.PLAY_PAUSE,
    (event) => {
      event.preventDefault();
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState();
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.toggle();
        return;
      }
      togglePlayPause();
      if (isPlaying && callbacks.onPause) {
        callbacks.onPause();
      } else if (!isPlaying && callbacks.onPlay) {
        callbacks.onPlay();
      }
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [togglePlayPause, isPlaying, callbacks]
  );

  // Navigation: Arrow Left - Previous frame
  useHotkeys(
    HOTKEYS.PREVIOUS_FRAME,
    (event) => {
      event.preventDefault();
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState();
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.frameBack(1);
        return;
      }
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
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState();
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.frameForward(1);
        return;
      }
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
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState();
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.seek(0);
        return;
      }
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
      const { hoveredPanel, playerMethods } = useSourcePlayerStore.getState();
      if (hoveredPanel === 'source' && playerMethods) {
        playerMethods.seek(playerMethods.getDurationInFrames() - 1);
        return;
      }
      const currentItems = useItemsStore.getState().items;
      const lastFrame = currentItems.reduce((max, item) => {
        const itemEnd = item.from + item.durationInFrames;
        return Math.max(max, itemEnd);
      }, 0);
      setCurrentFrame(lastFrame);
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );

  // Navigation: Down - Jump to next snap point (clip edge or marker)
  useHotkeys(
    HOTKEYS.NEXT_SNAP_POINT,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const nextEdge = getSnapPoints().find((edge) => edge > currentFrame);
      if (nextEdge !== undefined) {
        setCurrentFrame(nextEdge);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );

  // Navigation: Up - Jump to previous snap point (clip edge or marker)
  useHotkeys(
    HOTKEYS.PREVIOUS_SNAP_POINT,
    (event) => {
      event.preventDefault();
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const snapPoints = getSnapPoints();
      let previousEdge: number | undefined;
      for (let i = snapPoints.length - 1; i >= 0; i--) {
        if (snapPoints[i]! < currentFrame) {
          previousEdge = snapPoints[i]!;
          break;
        }
      }
      if (previousEdge !== undefined) {
        setCurrentFrame(previousEdge);
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame]
  );
}
