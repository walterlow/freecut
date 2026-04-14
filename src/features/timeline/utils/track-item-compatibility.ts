import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { getTrackKind, type TrackKind } from './classic-tracks';

export function getRequiredTrackKindForItemType(itemType: TimelineItem['type']): TrackKind {
  return itemType === 'audio' ? 'audio' : 'video';
}

export function getEffectiveTrackKindForItem(
  track: TimelineTrack,
  items: readonly TimelineItem[],
): TrackKind | null {
  const explicitKind = getTrackKind(track);
  if (explicitKind) {
    return explicitKind;
  }

  let hasAudioItems = false;
  for (const item of items) {
    if (item.trackId !== track.id) continue;
    if (item.type === 'audio') {
      hasAudioItems = true;
      continue;
    }

    return 'video';
  }

  return hasAudioItems ? 'audio' : null;
}

export function isTrackCompatibleWithItemType(
  track: TimelineTrack,
  items: readonly TimelineItem[],
  itemType: TimelineItem['type'],
): boolean {
  const effectiveKind = getEffectiveTrackKindForItem(track, items);
  const requiredKind = getRequiredTrackKindForItemType(itemType);

  return effectiveKind === requiredKind || (effectiveKind === null && requiredKind === 'video');
}

export function findCompatibleTrackForItemType(params: {
  tracks: readonly TimelineTrack[];
  items: readonly TimelineItem[];
  itemType: TimelineItem['type'];
  preferredTrackId?: string | null;
  includeLocked?: boolean;
  includeHidden?: boolean;
  allowPreferredTrackFallback?: boolean;
}): TimelineTrack | null {
  const {
    tracks,
    items,
    itemType,
    preferredTrackId,
    includeLocked = false,
    includeHidden = true,
    allowPreferredTrackFallback = true,
  } = params;

  const eligibleTracks = tracks.filter((track) => {
    if (track.isGroup) return false;
    if (!includeLocked && track.locked) return false;
    if (!includeHidden && track.visible === false) return false;
    return true;
  });
  const compatibleTracks = eligibleTracks.filter((track) => (
    isTrackCompatibleWithItemType(track, items, itemType)
  ));

  if (compatibleTracks.length === 0) {
    return null;
  }

  if (!preferredTrackId) {
    return [...compatibleTracks].sort((left, right) => left.order - right.order)[0] ?? null;
  }

  const preferredTrack = eligibleTracks.find((track) => track.id === preferredTrackId) ?? null;
  if (!preferredTrack) {
    return [...compatibleTracks].sort((left, right) => left.order - right.order)[0] ?? null;
  }

  const preferredCompatibleTrack = compatibleTracks.find((track) => track.id === preferredTrack.id);
  if (preferredCompatibleTrack) {
    return preferredCompatibleTrack;
  }

  if (!allowPreferredTrackFallback) {
    return null;
  }

  return [...compatibleTracks].sort((left, right) => {
    const leftDistance = Math.abs(left.order - preferredTrack.order);
    const rightDistance = Math.abs(right.order - preferredTrack.order);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return itemType === 'audio'
      ? right.order - left.order
      : left.order - right.order;
  })[0] ?? null;
}
