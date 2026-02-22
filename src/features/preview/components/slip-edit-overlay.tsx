import { useMemo } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { useSlipEditPreviewStore } from '@/features/timeline/stores/slip-edit-preview-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { EditFourUpPanels } from './edit-4up-panels';
import { getSourceFrameInfo } from './edit-overlay-utils';

interface SlipEditOverlayProps {
  fps: number;
}

/**
 * Find the clip on the same track whose end is closest to (and at/before)
 * the given item's start.
 */
function findPrevItem(
  item: TimelineItem,
  sameTrackItems: TimelineItem[],
): TimelineItem | null {
  let best: TimelineItem | null = null;
  let bestEnd = -Infinity;

  for (const candidate of sameTrackItems) {
    if (candidate.id === item.id) continue;
    const candidateEnd = candidate.from + candidate.durationInFrames;
    if (candidateEnd <= item.from && candidateEnd > bestEnd) {
      best = candidate;
      bestEnd = candidateEnd;
    }
  }

  return best;
}

/**
 * Find the clip on the same track whose start is closest to (and at/after)
 * the given item's end.
 */
function findNextItem(
  item: TimelineItem,
  sameTrackItems: TimelineItem[],
): TimelineItem | null {
  const itemEnd = item.from + item.durationInFrames;
  let best: TimelineItem | null = null;
  let bestStart = Infinity;

  for (const candidate of sameTrackItems) {
    if (candidate.id === item.id) continue;
    if (candidate.from >= itemEnd && candidate.from < bestStart) {
      best = candidate;
      bestStart = candidate.from;
    }
  }

  return best;
}

/**
 * 4-up overlay shown during slip edits.
 *
 * Center panels (large, dynamic):
 * - Left:  Slipped clip's new IN frame (sourceStart + slipDelta at local frame 0)
 * - Right: Slipped clip's new OUT frame (sourceStart + slipDelta at local frame durationInFrames - 1)
 *
 * Corner thumbnails (small, static):
 * - Top-left:  Previous clip's last frame (neighbor OUT)
 * - Top-right: Next clip's first frame (neighbor IN)
 */
export function SlipEditOverlay({ fps }: SlipEditOverlayProps) {
  const itemId = useSlipEditPreviewStore((s) => s.itemId);
  const trackId = useSlipEditPreviewStore((s) => s.trackId);
  const slipDelta = useSlipEditPreviewStore((s) => s.slipDelta);
  const items = useTimelineStore((s) => s.items);

  const itemsMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const slippedItem = itemId ? (itemsMap.get(itemId) ?? null) : null;

  const sameTrackItems = useMemo(
    () => (trackId ? items.filter((i) => i.trackId === trackId) : []),
    [items, trackId],
  );

  const prevItem = useMemo(
    () => (slippedItem ? findPrevItem(slippedItem, sameTrackItems) : null),
    [slippedItem, sameTrackItems],
  );

  const nextItem = useMemo(
    () => (slippedItem ? findNextItem(slippedItem, sameTrackItems) : null),
    [slippedItem, sameTrackItems],
  );

  if (!slippedItem) return null;

  // Create a virtual item with sourceStart/sourceEnd shifted by slipDelta
  // so getSourceFrameInfo seeks to the correct slipped source time.
  const virtualItem = {
    ...slippedItem,
    sourceStart: (slippedItem.sourceStart ?? 0) + slipDelta,
    sourceEnd:
      slippedItem.sourceEnd !== undefined
        ? slippedItem.sourceEnd + slipDelta
        : undefined,
  } as TimelineItem;

  // Center-left: new IN frame (local frame 0)
  const inInfo = getSourceFrameInfo(virtualItem, 0, fps);

  // Center-right: new OUT frame (local frame durationInFrames - 1)
  const outLocalFrame = Math.max(0, slippedItem.durationInFrames - 1);
  const outInfo = getSourceFrameInfo(virtualItem, outLocalFrame, fps);

  // Top-left corner: previous clip's last frame
  const topLeftCorner = prevItem
    ? (() => {
        const prevLastFrame = Math.max(0, prevItem.durationInFrames - 1);
        const prevInfo = getSourceFrameInfo(prevItem, prevLastFrame, fps);
        return {
          item: prevItem,
          sourceTime: prevInfo.sourceTime,
          timecode: prevInfo.timecode,
          label: '',
        };
      })()
    : undefined;

  // Top-right corner: next clip's first frame
  const topRightCorner = nextItem
    ? (() => {
        const nextInfo = getSourceFrameInfo(nextItem, 0, fps);
        return {
          item: nextItem,
          sourceTime: nextInfo.sourceTime,
          timecode: nextInfo.timecode,
          label: '',
        };
      })()
    : undefined;

  return (
    <EditFourUpPanels
      leftPanel={{
        item: virtualItem,
        sourceTime: inInfo.sourceTime,
        timecode: inInfo.timecode,
        label: 'IN',
      }}
      rightPanel={{
        item: virtualItem,
        sourceTime: outInfo.sourceTime,
        timecode: outInfo.timecode,
        label: 'OUT',
      }}
      topLeftCorner={topLeftCorner}
      topRightCorner={topRightCorner}
    />
  );
}
