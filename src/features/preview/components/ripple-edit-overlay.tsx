import { useMemo } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useRippleEditPreviewStore } from '@/features/timeline/stores/ripple-edit-preview-store';
import { EditTwoUpPanels } from './edit-2up-panels';
import { getSourceFrameInfo } from './edit-overlay-utils';

interface RippleEditOverlayProps {
  fps: number;
}

/**
 * Find the closest downstream item to the trimmed item's end.
 * Used for end-handle trims to show the IN panel.
 */
function pickNextItem(
  trimmedItem: TimelineItem,
  downstreamItems: TimelineItem[],
): TimelineItem | null {
  if (downstreamItems.length === 0) return null;

  const trimEnd = trimmedItem.from + trimmedItem.durationInFrames;
  let best: TimelineItem | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of downstreamItems) {
    const distance = Math.abs(candidate.from - trimEnd);
    if (
      distance < bestDistance ||
      (distance === bestDistance && best && candidate.from < best.from)
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * Find the clip on the same track whose end is closest to (and before)
 * the trimmed item's start. Used for start-handle trims to show the OUT panel.
 */
function pickPrevItem(
  trimmedItem: TimelineItem,
  sameTrackItems: TimelineItem[],
): TimelineItem | null {
  let best: TimelineItem | null = null;
  let bestEnd = -Infinity;

  for (const candidate of sameTrackItems) {
    if (candidate.id === trimmedItem.id) continue;
    const candidateEnd = candidate.from + candidate.durationInFrames;
    if (candidateEnd <= trimmedItem.from && candidateEnd > bestEnd) {
      best = candidate;
      bestEnd = candidateEnd;
    }
  }

  return best;
}

/**
 * 2-up frame comparison shown during ripple edits.
 *
 * Panels are edit-point-centric (matching commercial NLE conventions):
 * - OUT (left): last frame before the edit point
 * - IN (right): first frame after the edit point
 *
 * Which clip goes in which panel depends on the handle being trimmed:
 * - End handle:   OUT = trimmed clip's new last frame, IN = next clip's first frame
 * - Start handle: OUT = previous clip's last frame,    IN = trimmed clip's new first frame
 */
export function RippleEditOverlay({ fps }: RippleEditOverlayProps) {
  const trimmedItemId = useRippleEditPreviewStore((s) => s.trimmedItemId);
  const handle = useRippleEditPreviewStore((s) => s.handle);
  const trackId = useRippleEditPreviewStore((s) => s.trackId);
  const downstreamItemIds = useRippleEditPreviewStore((s) => s.downstreamItemIds);
  const delta = useRippleEditPreviewStore((s) => s.delta);
  const trimDelta = useRippleEditPreviewStore((s) => s.trimDelta);
  const items = useTimelineStore((s) => s.items);
  const itemsMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const trimmedItem = trimmedItemId ? (itemsMap.get(trimmedItemId) ?? null) : null;

  const downstreamItems = useMemo(
    () => items.filter((item) => downstreamItemIds.has(item.id)),
    [items, downstreamItemIds],
  );

  const nextItem = useMemo(
    () => (trimmedItem && handle === 'end' ? pickNextItem(trimmedItem, downstreamItems) : null),
    [trimmedItem, handle, downstreamItems],
  );

  const prevItem = useMemo(() => {
    if (!trimmedItem || !trackId || handle !== 'start') return null;
    const sameTrack = items.filter((item) => item.trackId === trackId);
    return pickPrevItem(trimmedItem, sameTrack);
  }, [trimmedItem, trackId, handle, items]);

  if (!trimmedItem || !handle) return null;

  // --- End-handle trim ---
  if (handle === 'end') {
    const editPointFrame = trimmedItem.from + trimmedItem.durationInFrames + delta;
    const outLocalFrame = Math.max(0, editPointFrame - trimmedItem.from - 1);
    const outInfo = getSourceFrameInfo(trimmedItem, outLocalFrame, fps);

    if (!nextItem) {
      return (
        <EditTwoUpPanels
          leftPanel={{
            item: trimmedItem,
            sourceTime: outInfo.sourceTime,
            timecode: outInfo.timecode,
            label: 'OUT',
          }}
          rightPanel={{
            item: null,
            timecode: '--:--:--:--',
            label: 'IN',
            placeholderText: 'GAP',
          }}
        />
      );
    }

    const shiftedNextFrom = nextItem.from + delta;
    const inLocalFrame = Math.max(0, editPointFrame - shiftedNextFrom);
    const inInfo = getSourceFrameInfo(nextItem, inLocalFrame, fps);

    return (
      <EditTwoUpPanels
        leftPanel={{
          item: trimmedItem,
          sourceTime: outInfo.sourceTime,
          timecode: outInfo.timecode,
          label: 'OUT',
        }}
        rightPanel={{
          item: nextItem,
          sourceTime: inInfo.sourceTime,
          timecode: inInfo.timecode,
          label: 'IN',
        }}
      />
    );
  }

  // --- Start-handle trim ---
  // Edit point is at the new start of the trimmed clip
  const editPointFrame = trimmedItem.from + trimDelta;

  // IN = trimmed clip at its new first visible frame
  // trimDelta frames into the original clip's range
  const inLocalFrame = Math.max(0, trimDelta);
  const inInfo = getSourceFrameInfo(trimmedItem, inLocalFrame, fps);

  if (!prevItem) {
    return (
      <EditTwoUpPanels
        leftPanel={{
          item: null,
          timecode: '--:--:--:--',
          label: 'OUT',
          placeholderText: 'GAP',
        }}
        rightPanel={{
          item: trimmedItem,
          sourceTime: inInfo.sourceTime,
          timecode: inInfo.timecode,
          label: 'IN',
        }}
      />
    );
  }

  // OUT = previous clip's last frame before the edit point
  const outLocalFrame = Math.max(0, editPointFrame - prevItem.from - 1);
  const outInfo = getSourceFrameInfo(prevItem, outLocalFrame, fps);

  return (
    <EditTwoUpPanels
      leftPanel={{
        item: prevItem,
        sourceTime: outInfo.sourceTime,
        timecode: outInfo.timecode,
        label: 'OUT',
      }}
      rightPanel={{
        item: trimmedItem,
        sourceTime: inInfo.sourceTime,
        timecode: inInfo.timecode,
        label: 'IN',
      }}
    />
  );
}
