import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { findNearestAvailableSpace } from './collision-utils';
import { resolveEffectiveTrackStates } from './group-utils';
import {
  findCompatibleTrackForItemType,
  isTrackCompatibleWithItemType,
} from './track-item-compatibility';

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
  itemType: TimelineItem['type'];
}

export function findBestCanvasDropPlacement(
  params: FindCanvasDropPlacementParams
): CanvasDropPlacement | null {
  const { tracks, items, activeTrackId, proposedFrame, durationInFrames, itemType } = params;
  const effectiveTracks = resolveEffectiveTrackStates(tracks).filter(
    (track) => !track.locked && !track.isGroup
  );

  if (effectiveTracks.length === 0) {
    return null;
  }

  const preferredTrack = findCompatibleTrackForItemType({
    tracks: effectiveTracks,
    items,
    itemType,
    preferredTrackId: activeTrackId,
  });
  const compatibleTrackIds = new Set(effectiveTracks
    .filter((track) => isTrackCompatibleWithItemType(track, items, itemType))
    .map((track) => track.id));

  const orderedTracks = activeTrackId
    ? effectiveTracks.toSorted((a, b) => {
      if (preferredTrack && a.id === preferredTrack.id) return -1;
      if (preferredTrack && b.id === preferredTrack.id) return 1;
      return a.order - b.order;
    })
    : effectiveTracks.toSorted((a, b) => a.order - b.order);

  for (const track of orderedTracks) {
    if (!compatibleTrackIds.has(track.id)) {
      continue;
    }

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
    if (!compatibleTrackIds.has(track.id)) {
      continue;
    }

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
