import type { CompositionInputProps } from '@/types/export';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';
import {
  normalizeFrameRanges,
  type FrameRange,
} from '@/shared/utils/frame-invalidation';

function indexItemsById(tracks: CompositionInputProps['tracks']): Map<string, TimelineItem> {
  const itemsById = new Map<string, TimelineItem>();
  for (const track of tracks) {
    for (const item of track.items as TimelineItem[]) {
      itemsById.set(item.id, item);
    }
  }
  return itemsById;
}

function indexKeyframesByItemId(keyframes: ItemKeyframes[] | undefined): Map<string, ItemKeyframes> {
  if (!keyframes || keyframes.length === 0) return new Map();
  return new Map(keyframes.map((entry) => [entry.itemId, entry]));
}

function getItemFrameRange(item: TimelineItem | undefined): FrameRange | null {
  if (!item) return null;
  const startFrame = Math.trunc(item.from);
  const endFrame = Math.trunc(item.from + item.durationInFrames);
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) {
    return null;
  }
  return { startFrame, endFrame };
}

export function collectVisualInvalidationRanges({
  previousTracks,
  nextTracks,
  previousKeyframes,
  nextKeyframes,
}: {
  previousTracks: CompositionInputProps['tracks'];
  nextTracks: CompositionInputProps['tracks'];
  previousKeyframes?: ItemKeyframes[];
  nextKeyframes?: ItemKeyframes[];
}): FrameRange[] {
  if (previousTracks === nextTracks && previousKeyframes === nextKeyframes) {
    return [];
  }

  const previousItemsById = indexItemsById(previousTracks);
  const nextItemsById = indexItemsById(nextTracks);
  const previousKeyframesByItemId = indexKeyframesByItemId(previousKeyframes);
  const nextKeyframesByItemId = indexKeyframesByItemId(nextKeyframes);
  const changedItemIds = new Set<string>();

  for (const [itemId, previousItem] of previousItemsById) {
    if (nextItemsById.get(itemId) !== previousItem) {
      changedItemIds.add(itemId);
    }
  }
  for (const [itemId, nextItem] of nextItemsById) {
    if (previousItemsById.get(itemId) !== nextItem) {
      changedItemIds.add(itemId);
    }
  }
  for (const [itemId, previousKeyframe] of previousKeyframesByItemId) {
    if (nextKeyframesByItemId.get(itemId) !== previousKeyframe) {
      changedItemIds.add(itemId);
    }
  }
  for (const [itemId, nextKeyframe] of nextKeyframesByItemId) {
    if (previousKeyframesByItemId.get(itemId) !== nextKeyframe) {
      changedItemIds.add(itemId);
    }
  }

  const ranges: FrameRange[] = [];
  for (const itemId of changedItemIds) {
    const previousRange = getItemFrameRange(previousItemsById.get(itemId));
    if (previousRange) {
      ranges.push(previousRange);
    }
    const nextRange = getItemFrameRange(nextItemsById.get(itemId));
    if (nextRange) {
      ranges.push(nextRange);
    }
  }

  return normalizeFrameRanges(ranges);
}
