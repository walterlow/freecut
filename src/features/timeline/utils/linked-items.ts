import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { getLinkedAudioCompanion, getLinkedVideoCompanion } from '@/shared/utils/linked-media';
import { applyMovePreview, type PreviewItemUpdate } from './item-edit-preview';
import { getSourceProperties, sourceToTimelineFrames } from './source-calculations';

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (left.type === 'video' && right.type === 'audio')
    || (left.type === 'audio' && right.type === 'video');
}

function isLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false;
  if (!anchor.originId || anchor.originId !== candidate.originId) return false;
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false;
  return anchor.from === candidate.from && anchor.durationInFrames === candidate.durationInFrames;
}

export function getLinkedItems(items: TimelineItem[], itemId: string): TimelineItem[] {
  const anchor = items.find((item) => item.id === itemId);
  if (!anchor) return [];

  if (anchor.linkedGroupId) {
    return items.filter((item) => item.linkedGroupId === anchor.linkedGroupId);
  }

  const legacyLinkedItems = items.filter((item) => item.id === itemId || isLegacyLinkedPair(anchor, item));
  return legacyLinkedItems.length > 1 ? legacyLinkedItems : [anchor];
}

export function getLinkedItemIds(items: TimelineItem[], itemId: string): string[] {
  return getLinkedItems(items, itemId).map((item) => item.id);
}

export function filterUnlockedItemIds(
  items: TimelineItem[],
  tracks: Pick<TimelineTrack, 'id' | 'locked'>[],
  itemIds: string[],
): string[] {
  if (itemIds.length === 0) {
    return [];
  }

  const lockedTrackIds = new Set(
    tracks
      .filter((track) => track.locked)
      .map((track) => track.id),
  );

  if (lockedTrackIds.size === 0) {
    return itemIds;
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  return itemIds.filter((itemId) => !lockedTrackIds.has(itemById.get(itemId)?.trackId ?? ''));
}

export function getUniqueLinkedItemAnchorIds(items: TimelineItem[], itemIds: string[]): string[] {
  const anchors: string[] = [];
  const visitedIds = new Set<string>();

  for (const itemId of itemIds) {
    if (visitedIds.has(itemId)) continue;

    const linkedIds = getLinkedItemIds(items, itemId);
    if (linkedIds.length === 0) continue;

    anchors.push(itemId);
    for (const linkedId of linkedIds) {
      visitedIds.add(linkedId);
    }
  }

  return anchors;
}

export function hasLinkedItems(items: TimelineItem[], itemId: string): boolean {
  return getLinkedItemIds(items, itemId).length > 1;
}

export function getSynchronizedLinkedItems(items: TimelineItem[], itemId: string): TimelineItem[] {
  const linkedItems = getLinkedItems(items, itemId);
  const anchor = linkedItems.find((item) => item.id === itemId);
  if (!anchor) return [];

  const synchronizedItems = linkedItems.filter((item) => (
    item.id === anchor.id
    || (
      item.from === anchor.from
      && item.durationInFrames === anchor.durationInFrames
      && (item.sourceStart ?? null) === (anchor.sourceStart ?? null)
      && (item.sourceEnd ?? null) === (anchor.sourceEnd ?? null)
      && (item.speed ?? 1) === (anchor.speed ?? 1)
    )
  ));

  return synchronizedItems.length > 0 ? synchronizedItems : [anchor];
}

export function getMatchingSynchronizedLinkedCounterpart(
  items: TimelineItem[],
  itemId: string,
  trackId: string,
  type: TimelineItem['type'],
): TimelineItem | null {
  return getSynchronizedLinkedItems(items, itemId).find((item) => (
    item.id !== itemId && item.trackId === trackId && item.type === type
  )) ?? null;
}

export function getSynchronizedLinkedCounterpartPair(
  items: TimelineItem[],
  leftId: string,
  rightId: string,
): { leftCounterpart: TimelineItem; rightCounterpart: TimelineItem } | null {
  const leftCounterparts = getSynchronizedLinkedItems(items, leftId).filter((item) => item.id !== leftId);
  const rightCounterparts = getSynchronizedLinkedItems(items, rightId).filter((item) => item.id !== rightId);

  for (const leftCounterpart of leftCounterparts) {
    const rightCounterpart = rightCounterparts.find((item) => (
      item.trackId === leftCounterpart.trackId && item.type === leftCounterpart.type
    ));
    if (rightCounterpart) {
      return { leftCounterpart, rightCounterpart };
    }
  }

  return null;
}

function getLinkedSyncAnchorFrame(item: TimelineItem, timelineFps: number): number {
  const { sourceStart, sourceFps, speed } = getSourceProperties(item);
  const sourceOffsetOnTimeline = sourceToTimelineFrames(
    sourceStart,
    speed,
    sourceFps ?? timelineFps,
    timelineFps,
  );

  return item.from - sourceOffsetOnTimeline;
}

function getLinkedSyncCompanion(items: TimelineItem[], anchor: TimelineItem): TimelineItem | null {
  if (anchor.type === 'video' || anchor.type === 'composition') {
    return getLinkedAudioCompanion(items, anchor);
  }

  if (anchor.type === 'audio') {
    return getLinkedVideoCompanion(items, anchor);
  }

  return null;
}

function applyPreviewUpdate(
  item: TimelineItem,
  previewUpdate: PreviewItemUpdate | null | undefined,
): TimelineItem {
  return previewUpdate
    ? ({ ...item, ...previewUpdate } as TimelineItem)
    : item;
}

export function getLinkedSyncOffsetFrames(
  items: TimelineItem[],
  itemId: string,
  timelineFps: number,
  previewUpdatesById: Readonly<Record<string, PreviewItemUpdate | undefined>> = {},
): number | null {
  const anchorBase = items.find((item) => item.id === itemId);
  if (!anchorBase) return null;

  const companionBase = getLinkedSyncCompanion(items, anchorBase);
  if (!companionBase) return null;

  const anchor = applyPreviewUpdate(anchorBase, previewUpdatesById[anchorBase.id]);
  const companion = applyPreviewUpdate(companionBase, previewUpdatesById[companionBase.id]);

  const anchorSyncFrame = getLinkedSyncAnchorFrame(anchor, timelineFps);
  const candidateOffset = anchorSyncFrame - getLinkedSyncAnchorFrame(companion, timelineFps);
  return candidateOffset === 0 ? null : candidateOffset;
}

export function buildSynchronizedLinkedMoveUpdates(
  items: TimelineItem[],
  baseDeltaByItemId: ReadonlyMap<string, number>,
): Array<{ id: string; from: number }> {
  const deltaByItemId = new Map(baseDeltaByItemId);
  const visited = new Set<string>();

  for (const item of items) {
    if (visited.has(item.id)) continue;

    const synchronizedItems = getSynchronizedLinkedItems(items, item.id);
    for (const synchronizedItem of synchronizedItems) {
      visited.add(synchronizedItem.id);
    }

    if (synchronizedItems.length <= 1) continue;

    const groupDelta = synchronizedItems.reduce((selected, synchronizedItem) => {
      const candidate = baseDeltaByItemId.get(synchronizedItem.id) ?? 0;
      return Math.abs(candidate) > Math.abs(selected) ? candidate : selected;
    }, 0);

    if (groupDelta === 0) continue;

    for (const synchronizedItem of synchronizedItems) {
      deltaByItemId.set(synchronizedItem.id, groupDelta);
    }
  }

  return items.flatMap((item) => {
    const delta = deltaByItemId.get(item.id) ?? 0;
    return delta !== 0
      ? [{ id: item.id, from: item.from + delta }]
      : [];
  });
}

export function buildLinkedMovePreviewUpdates(
  items: TimelineItem[],
  movedItems: Array<{ id: string; from: number }>,
): PreviewItemUpdate[] {
  if (movedItems.length === 0) {
    return [];
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  return movedItems.flatMap((movedItem) => {
    const sourceItem = itemById.get(movedItem.id);
    if (!sourceItem || sourceItem.from === movedItem.from || getLinkedItems(items, movedItem.id).length <= 1) {
      return [];
    }

    return [applyMovePreview(sourceItem, movedItem.from - sourceItem.from)];
  });
}

export function canLinkItems(items: TimelineItem[]): boolean {
  if (items.length !== 2) return false;

  const [left, right] = items;
  if (!left || !right) return false;
  if (!isMediaPair(left, right)) return false;
  if (!left.mediaId || left.mediaId !== right.mediaId) return false;
  if (left.from !== right.from) return false;
  if (left.durationInFrames !== right.durationInFrames) return false;

  if ((left.sourceStart ?? null) !== (right.sourceStart ?? null)) return false;
  if ((left.sourceEnd ?? null) !== (right.sourceEnd ?? null)) return false;

  return true;
}

export function canLinkSelection(items: TimelineItem[], itemIds: string[]): boolean {
  const uniqueSelectedIds = Array.from(new Set(itemIds)).filter((id) => items.some((item) => item.id === id));
  if (uniqueSelectedIds.length < 2) return false;

  const expandedIds = expandSelectionWithLinkedItems(items, uniqueSelectedIds);
  if (expandedIds.length < 2) return false;

  const [firstExpandedId] = expandedIds;
  if (!firstExpandedId) return false;

  const existingLinkedIds = new Set(getLinkedItemIds(items, firstExpandedId));
  return existingLinkedIds.size !== expandedIds.length
    || expandedIds.some((id) => !existingLinkedIds.has(id));
}

export function expandSelectionWithLinkedItems(items: TimelineItem[], itemIds: string[]): string[] {
  const expandedIds = new Set<string>();
  for (const itemId of itemIds) {
    for (const linkedId of getLinkedItemIds(items, itemId)) {
      expandedIds.add(linkedId);
    }
  }
  return Array.from(expandedIds);
}
