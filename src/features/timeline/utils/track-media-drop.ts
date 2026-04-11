import type { TimelineTrack } from '@/types/timeline';
import {
  buildCollisionTrackItemsMap,
  findNearestAvailableSpaceInTrackItems,
  type CollisionRect,
} from './collision-utils';
import {
  createClassicTrack,
  findNearestTrackByKind,
  getAdjacentTrackOrder,
  getTrackKind,
  renameTrackForKind,
  type TrackKind,
} from './classic-tracks';
import type { DroppableMediaType } from './dropped-media';
import { resolveLinkedDragTrackTargets } from './linked-drag-targeting';

export interface TrackMediaDropPlanEntry<T> {
  payload: T;
  label: string;
  mediaType: DroppableMediaType;
  durationInFrames: number;
  hasLinkedAudio?: boolean;
}

export interface TrackMediaDropPlacement {
  trackId: string;
  from: number;
  durationInFrames: number;
  mediaType: DroppableMediaType;
}

export interface TrackMediaDropPlannedItem<T> {
  entry: TrackMediaDropPlanEntry<T>;
  placements: TrackMediaDropPlacement[];
  linkVideoAudio: boolean;
}

export interface TrackMediaGhostPreview {
  left: number;
  width: number;
  label: string;
  type: DroppableMediaType;
  targetTrackId: string;
}

function resolveSyncedDropFrame(
  proposedFrom: number,
  durationInFrames: number,
  trackIds: string[],
  getTrackItemsToCheck: (trackId: string) => ReadonlyArray<CollisionRect>
): number | null {
  let candidate = Math.max(0, proposedFrom);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const positions = trackIds.map((trackId) => findNearestAvailableSpaceInTrackItems(
      candidate,
      durationInFrames,
      getTrackItemsToCheck(trackId),
    ));

    if (positions.some((position) => position === null)) {
      return null;
    }

    const normalized = positions as number[];
    const alignedFrom = Math.max(...normalized);
    if (normalized.every((position) => position === alignedFrom)) {
      return alignedFrom;
    }

    candidate = alignedFrom;
  }

  return null;
}

function ensureTrackForKind(
  currentTracks: TimelineTrack[],
  targetTrack: TimelineTrack,
  kind: TrackKind,
  directionWhenCreating: 'above' | 'below',
  preferTarget = false
): { tracks: TimelineTrack[]; trackId: string } {
  const targetKind = getTrackKind(targetTrack);

  if (preferTarget || targetKind === kind || targetKind === null) {
    const upgradedTrack = renameTrackForKind(targetTrack, currentTracks, kind);
    if (upgradedTrack === targetTrack) {
      return { tracks: currentTracks, trackId: targetTrack.id };
    }
    return {
      tracks: currentTracks.map((track) => track.id === targetTrack.id ? upgradedTrack : track),
      trackId: targetTrack.id,
    };
  }

  const existingTrack = findNearestTrackByKind({
    tracks: currentTracks,
    targetTrack,
    kind,
    direction: directionWhenCreating,
  });
  if (existingTrack) {
    return { tracks: currentTracks, trackId: existingTrack.id };
  }

  const createdTrack = createClassicTrack({
    tracks: currentTracks,
    kind,
    order: getAdjacentTrackOrder(currentTracks, targetTrack, directionWhenCreating),
  });
  return { tracks: [...currentTracks, createdTrack], trackId: createdTrack.id };
}

export function planTrackMediaDropPlacements<T>(params: {
  entries: Array<TrackMediaDropPlanEntry<T>>;
  dropFrame: number;
  tracks: TimelineTrack[];
  existingItems: CollisionRect[];
  existingTrackItemsById?: Map<string, CollisionRect[]>;
  dropTargetTrackId: string;
}): { plannedItems: Array<TrackMediaDropPlannedItem<T>>; tracks: TimelineTrack[] } {
  let currentPosition = Math.max(0, params.dropFrame);
  const reservedRanges: CollisionRect[] = [];
  const plannedItems: Array<TrackMediaDropPlannedItem<T>> = [];
  let workingTracks = [...params.tracks];
  const baseTrackItemsById = params.existingTrackItemsById ?? buildCollisionTrackItemsMap(params.existingItems);

  const getTrackItemsToCheck = (trackId: string): ReadonlyArray<CollisionRect> => {
    const baseTrackItems = baseTrackItemsById.get(trackId) ?? [];
    const reservedTrackItems = reservedRanges.filter((item) => item.trackId === trackId);
    if (reservedTrackItems.length === 0) {
      return baseTrackItems;
    }

    return [...baseTrackItems, ...reservedTrackItems].sort((a, b) => a.from - b.from);
  };

  for (const entry of params.entries) {
    const targetTrack = workingTracks.find((candidate) => candidate.id === params.dropTargetTrackId);
    if (!targetTrack) {
      continue;
    }

    const isVideoWithAudio = entry.mediaType === 'video' && !!entry.hasLinkedAudio;
    const isVisualMedia = entry.mediaType === 'video' || entry.mediaType === 'image';
    const targetTrackKind = getTrackKind(targetTrack);
    const requiredPrimaryKind: TrackKind = isVisualMedia ? 'video' : 'audio';

    const allowsLinkedAudioDrop = isVideoWithAudio && targetTrackKind === 'audio';

    if (targetTrackKind && targetTrackKind !== requiredPrimaryKind && !allowsLinkedAudioDrop) {
      continue;
    }

    const primaryTrackState = ensureTrackForKind(
      workingTracks,
      targetTrack,
      isVisualMedia ? 'video' : 'audio',
      isVisualMedia ? 'above' : 'below',
      getTrackKind(targetTrack) === null
    );
    workingTracks = primaryTrackState.tracks;

    let placements: TrackMediaDropPlacement[];

    if (isVideoWithAudio) {
      const hoveredKind = getTrackKind(targetTrack);
      const linkedTrackTargets = resolveLinkedDragTrackTargets({
        tracks: workingTracks,
        hoveredTrackId: params.dropTargetTrackId,
        zone: hoveredKind === 'audio' ? 'audio' : 'video',
        preferredTrackHeight: targetTrack.height,
      });

      if (!linkedTrackTargets) {
        continue;
      }
      workingTracks = linkedTrackTargets.tracks;

      const syncFrom = resolveSyncedDropFrame(
        currentPosition,
        entry.durationInFrames,
        [linkedTrackTargets.videoTrackId, linkedTrackTargets.audioTrackId],
        getTrackItemsToCheck,
      );

      if (syncFrom === null) {
        continue;
      }

      placements = [
        {
          trackId: linkedTrackTargets.videoTrackId,
          from: syncFrom,
          durationInFrames: entry.durationInFrames,
          mediaType: 'video',
        },
        {
          trackId: linkedTrackTargets.audioTrackId,
          from: syncFrom,
          durationInFrames: entry.durationInFrames,
          mediaType: 'audio',
        },
      ];
    } else {
      const finalPosition = findNearestAvailableSpaceInTrackItems(
        currentPosition,
        entry.durationInFrames,
        getTrackItemsToCheck(primaryTrackState.trackId),
      );

      if (finalPosition === null) {
        continue;
      }

      placements = [{
        trackId: primaryTrackState.trackId,
        from: finalPosition,
        durationInFrames: entry.durationInFrames,
        mediaType: entry.mediaType,
      }];
    }

    plannedItems.push({
      entry,
      placements,
      linkVideoAudio: isVideoWithAudio,
    });
    for (const placement of placements) {
      reservedRanges.push({
        from: placement.from,
        durationInFrames: placement.durationInFrames,
        trackId: placement.trackId,
      });
    }
    currentPosition = placements[0]!.from + entry.durationInFrames;
  }

  return {
    plannedItems,
    tracks: workingTracks,
  };
}

export function buildGhostPreviewsFromTrackMediaDropPlan<T>(params: {
  plannedItems: Array<TrackMediaDropPlannedItem<T>>;
  frameToPixels: (frame: number) => number;
}): TrackMediaGhostPreview[] {
  return params.plannedItems.flatMap((plannedItem) => (
    plannedItem.placements.map((placement) => ({
      left: params.frameToPixels(placement.from),
      width: params.frameToPixels(placement.durationInFrames),
      label: plannedItem.entry.label,
      type: placement.mediaType,
      targetTrackId: placement.trackId,
    }))
  ));
}
