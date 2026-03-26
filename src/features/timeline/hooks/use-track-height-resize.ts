import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useItemsStore } from '../stores/items-store';
import { captureSnapshot } from '../stores/commands/snapshot';
import { useTimelineCommandStore } from '../stores/timeline-command-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import type { TimelineSnapshot } from '../stores/commands/types';
import { resetAllTrackHeights, resizeAllTracksInList, resizeTrackInList } from '../utils/track-resize';
import { getTrackKind } from '../utils/classic-tracks';
import { DEFAULT_TRACK_HEIGHT } from '../constants';

interface TrackResizeState {
  trackId: string | null;
  startY: number;
  startHeight: number;
  currentHeight: number;
  deltaDirection: -1 | 1;
  applyToAll: boolean;
  didChange: boolean;
  beforeSnapshot: TimelineSnapshot | null;
}

const IDLE_RESIZE_STATE: TrackResizeState = {
  trackId: null,
  startY: 0,
  startHeight: 0,
  currentHeight: 0,
  deltaDirection: 1,
  applyToAll: false,
  didChange: false,
  beforeSnapshot: null,
};

export function useTrackHeightResize() {
  const [resizeState, setResizeState] = useState<TrackResizeState>(IDLE_RESIZE_STATE);
  const resizeStateRef = useRef(resizeState);
  resizeStateRef.current = resizeState;

  const finishResize = useCallback(() => {
    const state = resizeStateRef.current;
    if (!state.trackId) return;

    if (state.didChange && state.beforeSnapshot) {
      useTimelineCommandStore.getState().addUndoEntry(
        {
          type: state.applyToAll ? 'RESIZE_ALL_TRACKS' : 'RESIZE_TRACK',
          payload: state.applyToAll ? { count: useItemsStore.getState().tracks.length } : { id: state.trackId },
        },
        state.beforeSnapshot
      );
      useTimelineSettingsStore.getState().markDirty();
    }

    setResizeState(IDLE_RESIZE_STATE);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const state = resizeStateRef.current;
    if (!state.trackId) return;

    event.preventDefault();
    event.stopPropagation();

    const currentTracks = useItemsStore.getState().tracks;
    const nextHeight = state.startHeight + ((event.clientY - state.startY) * state.deltaDirection);
    const nextTracks = state.applyToAll
      ? resizeAllTracksInList(currentTracks, nextHeight)
      : resizeTrackInList(currentTracks, state.trackId, nextHeight);

    if (nextTracks === currentTracks) {
      return;
    }

    const resizedTrack = nextTracks.find((track) => track.id === state.trackId);
    if (!resizedTrack) return;

    useItemsStore.getState().setTracks(nextTracks);

    setResizeState((prev) => ({
      ...prev,
      currentHeight: resizedTrack.height,
      didChange: true,
    }));
  }, []);

  const handleMouseUp = useCallback((event: MouseEvent) => {
    if (!resizeStateRef.current.trackId) return;

    event.preventDefault();
    event.stopPropagation();
    finishResize();
  }, [finishResize]);

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLButtonElement>, trackId: string) => {
    const track = useItemsStore.getState().tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;

    event.preventDefault();
    event.stopPropagation();
    usePlaybackStore.getState().setPreviewFrame(null);

    setResizeState({
      trackId,
      startY: event.clientY,
      startHeight: track.height,
      currentHeight: track.height,
      deltaDirection: getTrackKind(track) === 'audio' ? 1 : -1,
      applyToAll: event.altKey,
      didChange: false,
      beforeSnapshot: captureSnapshot(),
    });

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeReset = useCallback((event: ReactMouseEvent<HTMLButtonElement>, trackId: string) => {
    const track = useItemsStore.getState().tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
      return;
    }

    const beforeSnapshot = captureSnapshot();
    const nextTracks = event.altKey
      ? resetAllTrackHeights(useItemsStore.getState().tracks)
      : resizeTrackInList(useItemsStore.getState().tracks, trackId, DEFAULT_TRACK_HEIGHT);

    event.preventDefault();
    event.stopPropagation();

    if (nextTracks === useItemsStore.getState().tracks) {
      return;
    }

    usePlaybackStore.getState().setPreviewFrame(null);
    useItemsStore.getState().setTracks(nextTracks);

    useTimelineCommandStore.getState().addUndoEntry(
      {
        type: event.altKey ? 'RESET_ALL_TRACK_HEIGHTS' : 'RESET_TRACK_HEIGHT',
        payload: event.altKey ? { count: nextTracks.length } : { id: trackId },
      },
      beforeSnapshot
    );
    useTimelineSettingsStore.getState().markDirty();
  }, []);

  useEffect(() => {
    if (!resizeState.trackId) return;

    document.addEventListener('mousemove', handleMouseMove, { capture: true });
    document.addEventListener('mouseup', handleMouseUp, { capture: true });

    const preventClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('click', preventClick, { capture: true, once: true });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove, { capture: true });
      document.removeEventListener('mouseup', handleMouseUp, { capture: true });
      document.removeEventListener('click', preventClick, { capture: true });
    };
  }, [handleMouseMove, handleMouseUp, resizeState.trackId]);

  return {
    handleTrackResizeStart: handleResizeStart,
    handleTrackResizeReset: handleResizeReset,
  };
}
