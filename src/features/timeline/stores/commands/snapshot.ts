import type { TimelineSnapshot } from './types';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useMarkersStore } from '../markers-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useCompositionsStore } from '../compositions-store';
import { usePlaybackStore } from '@/shared/state/playback';

/**
 * Capture a snapshot of all timeline state.
 * This is called before executing commands to enable undo.
 */
export function captureSnapshot(): TimelineSnapshot {
  const itemsState = useItemsStore.getState();
  const transitionsState = useTransitionsStore.getState();
  const keyframesState = useKeyframesStore.getState();
  const markersState = useMarkersStore.getState();
  const settingsState = useTimelineSettingsStore.getState();
  const compositionsState = useCompositionsStore.getState();
  const playbackState = usePlaybackStore.getState();

  return {
    items: itemsState.items,
    tracks: itemsState.tracks,
    transitions: transitionsState.transitions,
    keyframes: keyframesState.keyframes,
    markers: markersState.markers,
    compositions: compositionsState.compositions,
    inPoint: markersState.inPoint,
    outPoint: markersState.outPoint,
    fps: settingsState.fps,
    scrollPosition: settingsState.scrollPosition,
    snapEnabled: settingsState.snapEnabled,
    currentFrame: playbackState.currentFrame,
  };
}

/**
 * Restore all timeline state from a snapshot.
 * This is called during undo/redo to revert to a previous state.
 * All stores are updated synchronously to avoid inconsistent intermediate states.
 */
export function restoreSnapshot(snapshot: TimelineSnapshot): void {
  // Restore items and tracks
  useItemsStore.getState().setItems(snapshot.items);
  useItemsStore.getState().setTracks(snapshot.tracks);

  // Restore transitions
  useTransitionsStore.getState().setTransitions(snapshot.transitions);

  // Restore keyframes
  useKeyframesStore.getState().setKeyframes(snapshot.keyframes);

  // Restore markers and in/out points
  useMarkersStore.getState().setMarkers(snapshot.markers);
  useMarkersStore.getState().setInPoint(snapshot.inPoint);
  useMarkersStore.getState().setOutPoint(snapshot.outPoint);

  // Restore compositions
  useCompositionsStore.getState().setCompositions(snapshot.compositions);

  // Restore settings
  useTimelineSettingsStore.getState().setFps(snapshot.fps);
  useTimelineSettingsStore.getState().setScrollPosition(snapshot.scrollPosition);
  useTimelineSettingsStore.getState().setSnapEnabled(snapshot.snapEnabled);

  // Restore playhead position
  usePlaybackStore.getState().setCurrentFrame(snapshot.currentFrame);
}

/**
 * Check if two snapshots are equal (for deduplication).
 * Uses reference equality for performance.
 */
export function snapshotsEqual(a: TimelineSnapshot, b: TimelineSnapshot): boolean {
  return (
    a.items === b.items &&
    a.tracks === b.tracks &&
    a.transitions === b.transitions &&
    a.keyframes === b.keyframes &&
    a.markers === b.markers &&
    a.compositions === b.compositions &&
    a.inPoint === b.inPoint &&
    a.outPoint === b.outPoint &&
    a.fps === b.fps &&
    a.scrollPosition === b.scrollPosition &&
    a.snapEnabled === b.snapEnabled &&
    a.currentFrame === b.currentFrame
  );
}
