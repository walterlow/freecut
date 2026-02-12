import type { TimelineItem } from '@/types/timeline';
import { areFramesAligned } from './transition-utils';

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
  if (!areFramesAligned(leftItem.from + leftItem.durationInFrames, rightItem.from)) return false;
  // Must have same speed
  if ((leftItem.speed || 1) !== (rightItem.speed || 1)) return false;

  // Verify source continuity (no trim gap between clips)
  const leftSourceEnd = leftItem.sourceEnd ?? ((leftItem.sourceStart ?? 0) + leftItem.durationInFrames * (leftItem.speed || 1));
  const rightSourceStart = rightItem.sourceStart ?? 0;
  if (Math.abs(leftSourceEnd - rightSourceStart) > 0.5) return false; // Allow small floating point tolerance

  return true;
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
