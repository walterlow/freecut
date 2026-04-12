import { useItemsStore } from '../items-store';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { isTrackSyncLockEnabled } from '../../utils/track-sync-lock';
import type { PreviewItemUpdate } from '../../utils/item-edit-preview';
import { applySplitBookkeeping } from './split-bookkeeping';

export interface RipplePropagationResult {
  affectedIds: string[];
  removedIds: string[];
}

interface TimeInterval {
  start: number;
  end: number;
}

interface PreviewTrackItemState {
  id: string;
  trackId: string;
  from: number;
  durationInFrames: number;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function normalizeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = intervals
    .map((interval) => ({
      start: Math.max(0, Math.round(interval.start)),
      end: Math.max(0, Math.round(interval.end)),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  if (sorted.length === 0) {
    return [];
  }

  const merged: TimeInterval[] = [sorted[0]!];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const previous = merged[merged.length - 1]!;
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function getCandidateTrackIdsFromState(
  items: TimelineItem[],
  tracks: TimelineTrack[],
  editedTrackIds: Set<string>,
): string[] {
  const trackIds = new Set<string>();

  for (const track of tracks) {
    if (!editedTrackIds.has(track.id) && isTrackSyncLockEnabled(track)) {
      trackIds.add(track.id);
    }
  }

  for (const item of items) {
    if (editedTrackIds.has(item.trackId)) continue;
    if (trackIds.has(item.trackId)) continue;

    const track = tracks.find((candidate) => candidate.id === item.trackId);
    if (isTrackSyncLockEnabled(track)) {
      trackIds.add(item.trackId);
    }
  }

  return [...trackIds];
}

function getCandidateTrackIds(editedTrackIds: Set<string>): string[] {
  const { items, tracks } = useItemsStore.getState();
  return getCandidateTrackIdsFromState(items, tracks, editedTrackIds);
}

function toPreviewTrackState(item: TimelineItem): PreviewTrackItemState {
  return {
    id: item.id,
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
  };
}

function setPreviewUpdate(
  updatesById: Map<string, PreviewItemUpdate>,
  itemId: string,
  updates: Omit<PreviewItemUpdate, 'id'>,
): void {
  updatesById.set(itemId, {
    ...(updatesById.get(itemId) ?? { id: itemId }),
    ...updates,
  });
}

function splitItemWithBookkeeping(
  itemId: string,
  splitFrame: number,
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
  const current = useItemsStore.getState().itemById[itemId];
  if (!current) {
    return null;
  }

  const result = useItemsStore.getState()._splitItem(itemId, splitFrame);
  if (!result) {
    return null;
  }

  applySplitBookkeeping([{
    originalId: current.id,
    originalLinkedGroupId: current.linkedGroupId,
    result,
  }]);

  return result;
}

function buildRemovedIntervalPreviewUpdatesForTrack(
  trackItems: TimelineItem[],
  intervals: TimeInterval[],
): PreviewItemUpdate[] {
  let previewItems = trackItems
    .map(toPreviewTrackState)
    .sort((left, right) => left.from - right.from);
  const updatesById = new Map<string, PreviewItemUpdate>();

  let removedFrames = 0;
  for (const interval of normalizeIntervals(intervals)) {
    const currentInterval = {
      start: interval.start - removedFrames,
      end: interval.end - removedFrames,
    };
    const intervalLength = currentInterval.end - currentInterval.start;
    if (intervalLength <= 0) continue;

    const nextPreviewItems: PreviewTrackItemState[] = [];
    for (const item of previewItems) {
      const itemEnd = item.from + item.durationInFrames;
      if (itemEnd <= currentInterval.start) {
        nextPreviewItems.push(item);
        continue;
      }

      if (item.from >= currentInterval.end) {
        const updated = {
          ...item,
          from: Math.max(0, item.from - intervalLength),
        };
        nextPreviewItems.push(updated);
        setPreviewUpdate(updatesById, item.id, { from: updated.from });
        continue;
      }

      const startsBeforeInterval = item.from < currentInterval.start;
      const endsAfterInterval = itemEnd > currentInterval.end;

      if (!startsBeforeInterval && !endsAfterInterval) {
        setPreviewUpdate(updatesById, item.id, { hidden: true });
        continue;
      }

      if (startsBeforeInterval && endsAfterInterval) {
        const updated = {
          ...item,
          durationInFrames: Math.max(1, item.durationInFrames - intervalLength),
        };
        nextPreviewItems.push(updated);
        setPreviewUpdate(updatesById, item.id, {
          durationInFrames: updated.durationInFrames,
        });
        continue;
      }

      if (startsBeforeInterval) {
        const updated = {
          ...item,
          durationInFrames: Math.max(1, currentInterval.start - item.from),
        };
        nextPreviewItems.push(updated);
        setPreviewUpdate(updatesById, item.id, {
          durationInFrames: updated.durationInFrames,
        });
        continue;
      }

      const updated = {
        ...item,
        from: currentInterval.start,
        durationInFrames: Math.max(1, itemEnd - currentInterval.end),
      };
      nextPreviewItems.push(updated);
      setPreviewUpdate(updatesById, item.id, {
        from: updated.from,
        durationInFrames: updated.durationInFrames,
      });
    }

    previewItems = nextPreviewItems.sort((left, right) => left.from - right.from);
    removedFrames += intervalLength;
  }

  return [...updatesById.values()];
}

function buildInsertedGapPreviewUpdatesForTrack(
  trackItems: TimelineItem[],
  cutFrame: number,
  amount: number,
): PreviewItemUpdate[] {
  const updatesById = new Map<string, PreviewItemUpdate>();
  for (const item of trackItems) {
    const itemEnd = item.from + item.durationInFrames;
    if (itemEnd <= cutFrame) {
      continue;
    }

    if (item.from >= cutFrame) {
      setPreviewUpdate(updatesById, item.id, {
        from: item.from + amount,
      });
      continue;
    }

    setPreviewUpdate(updatesById, item.id, {
      durationInFrames: item.durationInFrames + amount,
    });
  }

  return [...updatesById.values()];
}

export function buildRemovedIntervalPreviewUpdatesForSyncLockedTracks(params: {
  items: TimelineItem[];
  tracks: TimelineTrack[];
  editedTrackIds: Set<string>;
  intervals: TimeInterval[];
}): PreviewItemUpdate[] {
  const intervals = normalizeIntervals(params.intervals);
  if (intervals.length === 0) {
    return [];
  }

  const candidateTrackIds = getCandidateTrackIdsFromState(
    params.items,
    params.tracks,
    params.editedTrackIds,
  );

  return candidateTrackIds.flatMap((trackId) => buildRemovedIntervalPreviewUpdatesForTrack(
    params.items.filter((item) => item.trackId === trackId),
    intervals,
  ));
}

export function buildInsertedGapPreviewUpdatesForSyncLockedTracks(params: {
  items: TimelineItem[];
  tracks: TimelineTrack[];
  editedTrackIds: Set<string>;
  cutFrame: number;
  amount: number;
}): PreviewItemUpdate[] {
  const cutFrame = Math.max(0, Math.round(params.cutFrame));
  const amount = Math.max(0, Math.round(params.amount));
  if (amount === 0) {
    return [];
  }

  const candidateTrackIds = getCandidateTrackIdsFromState(
    params.items,
    params.tracks,
    params.editedTrackIds,
  );

  return candidateTrackIds.flatMap((trackId) => buildInsertedGapPreviewUpdatesForTrack(
    params.items.filter((item) => item.trackId === trackId),
    cutFrame,
    amount,
  ));
}

function removeItemsOnTrackInterval(trackId: string, interval: TimeInterval): RipplePropagationResult {
  const store = useItemsStore.getState();
  const affectedIds: string[] = [];
  const removedIds: string[] = [];
  const overlapping = useItemsStore.getState().items
    .filter((item) => item.trackId === trackId && item.from < interval.end && item.from + item.durationInFrames > interval.start)
    .sort((left, right) => left.from - right.from);

  for (const overlappingItem of overlapping) {
    const current = useItemsStore.getState().itemById[overlappingItem.id];
    if (!current || current.trackId !== trackId) continue;

    const itemEnd = current.from + current.durationInFrames;
    const startsBeforeInterval = current.from < interval.start;
    const endsAfterInterval = itemEnd > interval.end;

    if (!startsBeforeInterval && !endsAfterInterval) {
      store._removeItems([current.id]);
      removedIds.push(current.id);
      continue;
    }

    if (startsBeforeInterval && endsAfterInterval) {
      const splitAtStart = splitItemWithBookkeeping(current.id, interval.start);
      if (!splitAtStart) continue;
      affectedIds.push(splitAtStart.leftItem.id, splitAtStart.rightItem.id);

      const splitAtEnd = splitItemWithBookkeeping(splitAtStart.rightItem.id, interval.end);
      if (!splitAtEnd) continue;
      store._removeItems([splitAtEnd.leftItem.id]);
      removedIds.push(splitAtEnd.leftItem.id);
      affectedIds.push(splitAtEnd.rightItem.id);
      continue;
    }

    if (startsBeforeInterval) {
      const split = splitItemWithBookkeeping(current.id, interval.start);
      if (!split) continue;
      store._removeItems([split.rightItem.id]);
      removedIds.push(split.rightItem.id);
      affectedIds.push(split.leftItem.id);
      continue;
    }

    const split = splitItemWithBookkeeping(current.id, interval.end);
    if (!split) continue;
    store._removeItems([split.leftItem.id]);
    removedIds.push(split.leftItem.id);
    affectedIds.push(split.rightItem.id);
  }

  return {
    affectedIds: uniqueIds(affectedIds),
    removedIds: uniqueIds(removedIds),
  };
}

function shiftTrackItems(trackId: string, predicate: (item: TimelineItem) => boolean, delta: number): string[] {
  if (delta === 0) {
    return [];
  }

  const store = useItemsStore.getState();
  const updates = useItemsStore.getState().items
    .filter((item) => item.trackId === trackId && predicate(item))
    .map((item) => ({
      id: item.id,
      from: Math.max(0, item.from + delta),
    }));

  if (updates.length > 0) {
    store._moveItems(updates);
  }

  return updates.map((update) => update.id);
}

export function propagateRemovedIntervalsToSyncLockedTracks(params: {
  editedTrackIds: Set<string>;
  intervals: TimeInterval[];
}): RipplePropagationResult {
  const intervals = normalizeIntervals(params.intervals);
  if (intervals.length === 0) {
    return { affectedIds: [], removedIds: [] };
  }

  const candidateTrackIds = getCandidateTrackIds(params.editedTrackIds);
  const affectedIds: string[] = [];
  const removedIds: string[] = [];

  for (const trackId of candidateTrackIds) {
    let removedFrames = 0;
    for (const interval of intervals) {
      const currentInterval = {
        start: interval.start - removedFrames,
        end: interval.end - removedFrames,
      };
      const intervalLength = currentInterval.end - currentInterval.start;
      if (intervalLength <= 0) continue;

      const overlapResult = removeItemsOnTrackInterval(trackId, currentInterval);
      affectedIds.push(...overlapResult.affectedIds);
      removedIds.push(...overlapResult.removedIds);
      affectedIds.push(
        ...shiftTrackItems(
          trackId,
          (item) => item.from >= currentInterval.end,
          -intervalLength,
        ),
      );

      removedFrames += intervalLength;
    }
  }

  return {
    affectedIds: uniqueIds(affectedIds),
    removedIds: uniqueIds(removedIds),
  };
}

export function propagateInsertedGapToSyncLockedTracks(params: {
  editedTrackIds: Set<string>;
  cutFrame: number;
  amount: number;
}): RipplePropagationResult {
  const cutFrame = Math.max(0, Math.round(params.cutFrame));
  const amount = Math.max(0, Math.round(params.amount));
  if (amount === 0) {
    return { affectedIds: [], removedIds: [] };
  }

  const candidateTrackIds = getCandidateTrackIds(params.editedTrackIds);
  const affectedIds: string[] = [];

  for (const trackId of candidateTrackIds) {
    const straddledItems = useItemsStore.getState().items
      .filter((item) => item.trackId === trackId && item.from < cutFrame && item.from + item.durationInFrames > cutFrame)
      .sort((left, right) => left.from - right.from);

    for (const straddledItem of straddledItems) {
      const current = useItemsStore.getState().itemById[straddledItem.id];
      if (!current || current.trackId !== trackId) continue;
      const splitResult = splitItemWithBookkeeping(current.id, cutFrame);
      if (!splitResult) continue;
      affectedIds.push(splitResult.leftItem.id, splitResult.rightItem.id);
    }

    affectedIds.push(
      ...shiftTrackItems(
        trackId,
        (item) => item.from >= cutFrame,
        amount,
      ),
    );
  }

  return {
    affectedIds: uniqueIds(affectedIds),
    removedIds: [],
  };
}
