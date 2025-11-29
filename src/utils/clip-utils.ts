import type { TimelineItem } from '@/types/timeline';

export function calculateItemDuration(item: TimelineItem): number {
  return item.durationInFrames;
}

export function isItemOverlapping(item1: TimelineItem, item2: TimelineItem): boolean {
  // Check if items are on the same track
  if (item1.trackId !== item2.trackId) {
    return false;
  }

  const item1End = item1.from + item1.durationInFrames;
  const item2End = item2.from + item2.durationInFrames;

  // Check for overlap
  return item1.from < item2End && item2.from < item1End;
}

export function splitItem(item: TimelineItem, splitFrame: number): [TimelineItem, TimelineItem] | null {
  // Check if split point is within the item
  if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
    return null;
  }

  const firstPartDuration = splitFrame - item.from;
  const secondPartDuration = item.durationInFrames - firstPartDuration;

  // Get current source/trim properties
  const currentSourceStart = item.sourceStart || 0;
  const currentTrimStart = item.trimStart || 0;
  const currentTrimEnd = item.trimEnd || 0;

  // Account for playback speed when calculating source positions
  // Timeline frames * speed = source frames consumed
  // IMPORTANT: Calculate second part as remainder to avoid rounding gaps
  const speed = item.speed || 1;
  const totalSourceFrames = Math.round(item.durationInFrames * speed);
  const firstPartSourceFrames = Math.round(firstPartDuration * speed);
  const secondPartSourceFrames = totalSourceFrames - firstPartSourceFrames;

  const firstPart: TimelineItem = {
    ...item,
    id: `${item.id}-1`,
    durationInFrames: firstPartDuration,
    // Update sourceEnd and trimEnd for left item (in source frames)
    sourceEnd: currentSourceStart + firstPartSourceFrames,
    trimEnd: currentTrimEnd + secondPartSourceFrames,
  };

  const secondPart: TimelineItem = {
    ...item,
    id: `${item.id}-2`,
    from: splitFrame,
    durationInFrames: secondPartDuration,
    // Update trimStart and sourceStart for right item (in source frames)
    trimStart: currentTrimStart + firstPartSourceFrames,
    sourceStart: currentSourceStart + firstPartSourceFrames,
  };

  return [firstPart, secondPart];
}

/**
 * Check if two items can be joined (inverse of split)
 * Items must satisfy ALL conditions:
 * - Same originId (from a split operation)
 * - Same trackId (on same track)
 * - Same mediaId (from same source)
 * - Adjacent position (left ends where right begins)
 * - Same speed
 * - Source continuity (left.sourceEnd === right.sourceStart)
 */
export function canJoinItems(leftItem: TimelineItem, rightItem: TimelineItem): boolean {
  // Must share same origin (from a split operation)
  if (leftItem.originId !== rightItem.originId) return false;
  // Must be on same track
  if (leftItem.trackId !== rightItem.trackId) return false;
  // Must be from same source media
  if (leftItem.mediaId !== rightItem.mediaId) return false;
  // Must be adjacent (left ends where right begins)
  if (leftItem.from + leftItem.durationInFrames !== rightItem.from) return false;
  // Must have same speed
  if ((leftItem.speed || 1) !== (rightItem.speed || 1)) return false;

  // Verify source continuity (no trim gap between clips)
  const leftSourceEnd = leftItem.sourceEnd ?? ((leftItem.sourceStart ?? 0) + leftItem.durationInFrames * (leftItem.speed || 1));
  const rightSourceStart = rightItem.sourceStart ?? 0;
  if (Math.abs(leftSourceEnd - rightSourceStart) > 0.5) return false; // Allow small floating point tolerance

  return true;
}

/**
 * Given two items, determine which is left and which is right based on position
 * Returns [leftItem, rightItem] or null if items are on different tracks
 */
export function orderItemsByPosition(item1: TimelineItem, item2: TimelineItem): [TimelineItem, TimelineItem] | null {
  if (item1.trackId !== item2.trackId) return null;
  return item1.from < item2.from ? [item1, item2] : [item2, item1];
}

/**
 * Check if multiple items can be joined (form a contiguous joinable chain)
 * Items must be sorted by position and each adjacent pair must pass canJoinItems
 */
export function canJoinMultipleItems(items: TimelineItem[]): boolean {
  if (items.length < 2) return false;

  // Sort by position
  const sorted = [...items].sort((a, b) => a.from - b.from);

  // Check each adjacent pair
  for (let i = 0; i < sorted.length - 1; i++) {
    if (!canJoinItems(sorted[i]!, sorted[i + 1]!)) {
      return false;
    }
  }

  return true;
}

/**
 * Find all contiguous joinable neighbors for a given item
 * Returns array of item IDs including the original item, sorted by position
 */
export function findJoinableChain(item: TimelineItem, allItems: TimelineItem[]): string[] {
  const chain: TimelineItem[] = [item];

  // Find all joinable items to the left
  let current = item;
  while (true) {
    const leftNeighbor = allItems.find(
      (other) =>
        other.id !== current.id &&
        other.trackId === current.trackId &&
        other.from + other.durationInFrames === current.from &&
        canJoinItems(other, current)
    );
    if (!leftNeighbor) break;
    chain.unshift(leftNeighbor);
    current = leftNeighbor;
  }

  // Find all joinable items to the right
  current = item;
  while (true) {
    const rightNeighbor = allItems.find(
      (other) =>
        other.id !== current.id &&
        other.trackId === current.trackId &&
        other.from === current.from + current.durationInFrames &&
        canJoinItems(current, other)
    );
    if (!rightNeighbor) break;
    chain.push(rightNeighbor);
    current = rightNeighbor;
  }

  return chain.map((i) => i.id);
}
