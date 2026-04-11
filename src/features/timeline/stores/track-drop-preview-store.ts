import { create } from 'zustand';
import type { DroppableMediaType } from '../utils/dropped-media';

export interface TrackDropGhostPreview {
  left: number;
  width: number;
  label: string;
  type: 'composition' | DroppableMediaType | 'external-file' | 'text' | 'shape' | 'adjustment';
  targetTrackId: string;
}

export const EMPTY_TRACK_DROP_GHOST_PREVIEWS: TrackDropGhostPreview[] = [];

type TrackDropGhostPreviewMap = Record<string, TrackDropGhostPreview[]>;

interface TrackDropPreviewState {
  ghostPreviewsByTrackId: TrackDropGhostPreviewMap;
  setGhostPreviews: (ghostPreviews: TrackDropGhostPreview[]) => void;
  clearGhostPreviews: () => void;
}

function areGhostPreviewListsEqual(
  previous: TrackDropGhostPreview[],
  next: TrackDropGhostPreview[]
): boolean {
  if (previous === next) {
    return true;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const previousPreview = previous[index]!;
    const nextPreview = next[index]!;

    if (
      previousPreview.left !== nextPreview.left
      || previousPreview.width !== nextPreview.width
      || previousPreview.label !== nextPreview.label
      || previousPreview.type !== nextPreview.type
      || previousPreview.targetTrackId !== nextPreview.targetTrackId
    ) {
      return false;
    }
  }

  return true;
}

function reconcileGhostPreviewMap(
  previousMap: TrackDropGhostPreviewMap,
  nextGhostPreviews: TrackDropGhostPreview[]
): TrackDropGhostPreviewMap {
  const nextMap: TrackDropGhostPreviewMap = {};

  for (const preview of nextGhostPreviews) {
    const existingTrackPreviews = nextMap[preview.targetTrackId];
    if (existingTrackPreviews) {
      existingTrackPreviews.push(preview);
    } else {
      nextMap[preview.targetTrackId] = [preview];
    }
  }

  const previousTrackIds = Object.keys(previousMap);
  const nextTrackIds = Object.keys(nextMap);
  let hasAnyChange = previousTrackIds.length !== nextTrackIds.length;
  const reconciledMap: TrackDropGhostPreviewMap = {};

  for (const trackId of nextTrackIds) {
    const nextTrackPreviews = nextMap[trackId]!;
    const previousTrackPreviews = previousMap[trackId];

    if (!previousTrackPreviews) {
      hasAnyChange = true;
      reconciledMap[trackId] = nextTrackPreviews;
      continue;
    }

    if (areGhostPreviewListsEqual(previousTrackPreviews, nextTrackPreviews)) {
      reconciledMap[trackId] = previousTrackPreviews;
      continue;
    }

    hasAnyChange = true;
    reconciledMap[trackId] = nextTrackPreviews;
  }

  return hasAnyChange ? reconciledMap : previousMap;
}

export const useTrackDropPreviewStore = create<TrackDropPreviewState>((set) => ({
  ghostPreviewsByTrackId: {},
  setGhostPreviews: (ghostPreviews) => set((state) => {
    const ghostPreviewsByTrackId = reconcileGhostPreviewMap(state.ghostPreviewsByTrackId, ghostPreviews);
    return ghostPreviewsByTrackId === state.ghostPreviewsByTrackId ? state : { ghostPreviewsByTrackId };
  }),
  clearGhostPreviews: () => set((state) => (
    Object.keys(state.ghostPreviewsByTrackId).length === 0
      ? state
      : { ghostPreviewsByTrackId: {} }
  )),
}));
