import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { findNearestAvailableSpace } from './collision-utils';
import { resolveEffectiveTrackStates } from './group-utils';

export interface CanvasDropPlacement {
  trackId: string;
  from: number;
  preservedTime: boolean;
}

interface FindCanvasDropPlacementParams {
  tracks: TimelineTrack[];
  items: TimelineItem[];
  activeTrackId: string | null;
  proposedFrame: number;
  durationInFrames: number;
}

export function findBestCanvasDropPlacement(
  params: FindCanvasDropPlacementParams
): CanvasDropPlacement | null {
  const { tracks, items, activeTrackId, proposedFrame, durationInFrames } = params;
  const effectiveTracks = resolveEffectiveTrackStates(tracks).filter(
    (track) => track.visible !== false && !track.locked && !track.isGroup
  );

  if (effectiveTracks.length === 0) {
    return null;
  }

  const orderedTracks = activeTrackId
    ? effectiveTracks.toSorted((a, b) => {
      if (a.id === activeTrackId) return -1;
      if (b.id === activeTrackId) return 1;
      return a.order - b.order;
    })
    : effectiveTracks.toSorted((a, b) => a.order - b.order);

  for (const track of orderedTracks) {
    const finalPosition = findNearestAvailableSpace(
      proposedFrame,
      durationInFrames,
      track.id,
      items
    );
    if (finalPosition === proposedFrame) {
      return {
        trackId: track.id,
        from: finalPosition,
        preservedTime: true,
      };
    }
  }

  for (const track of orderedTracks) {
    const finalPosition = findNearestAvailableSpace(
      proposedFrame,
      durationInFrames,
      track.id,
      items
    );
    if (finalPosition !== null) {
      return {
        trackId: track.id,
        from: finalPosition,
        preservedTime: false,
      };
    }
  }

  return null;
}
