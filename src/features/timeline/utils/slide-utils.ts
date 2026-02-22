import type { TimelineItem } from '@/types/timeline';
import { canJoinItems } from './clip-utils';
import { timelineToSourceFrames } from './source-calculations';
import { computeClampedSlipDelta } from './slip-utils';

/**
 * Compute source-window delta needed to preserve split-chain continuity during slide.
 *
 * Returns 0 unless ALL conditions are true:
 * - Left + slid + right form a split-contiguous chain (joinable pairs).
 * - Slid item is media with explicit sourceEnd.
 * - Full source delta is available inside source bounds (no clamping required).
 */
export function computeSlideContinuitySourceDelta(
  slidItem: TimelineItem,
  leftNeighbor: TimelineItem | null,
  rightNeighbor: TimelineItem | null,
  slideDelta: number,
  timelineFps: number,
): number {
  if (slideDelta === 0) return 0;
  if (!leftNeighbor || !rightNeighbor) return 0;
  if (!canJoinItems(leftNeighbor, slidItem) || !canJoinItems(slidItem, rightNeighbor)) return 0;
  if (slidItem.type !== 'video' && slidItem.type !== 'audio') return 0;
  if (slidItem.sourceEnd === undefined) return 0;

  const speed = slidItem.speed ?? 1;
  const sourceFps = slidItem.sourceFps ?? timelineFps;
  const sourceStart = slidItem.sourceStart ?? 0;
  const sourceEnd = slidItem.sourceEnd;
  const sourceDelta = timelineToSourceFrames(slideDelta, speed, timelineFps, sourceFps);
  const clamped = computeClampedSlipDelta(
    sourceStart,
    sourceEnd,
    slidItem.sourceDuration,
    sourceDelta,
  );

  return clamped === sourceDelta ? sourceDelta : 0;
}

