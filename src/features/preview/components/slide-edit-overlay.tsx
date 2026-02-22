import { useMemo } from 'react';
import { useSlideEditPreviewStore } from '@/features/timeline/stores/slide-edit-preview-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { EditFourUpPanels } from './edit-4up-panels';
import { getSourceFrameInfo } from './edit-overlay-utils';

interface SlideEditOverlayProps {
  fps: number;
}

/**
 * 4-up frame overlay shown during slide edits.
 *
 * Center panels (large, dynamic):
 *   - OUT (left):  left neighbor's new last frame
 *   - IN (right):  right neighbor's new first frame
 *
 * Corner thumbnails (small, static):
 *   - Top-left:  slid clip's first frame (content unchanged)
 *   - Top-right: slid clip's last frame  (content unchanged)
 */
export function SlideEditOverlay({ fps }: SlideEditOverlayProps) {
  const itemId = useSlideEditPreviewStore((s) => s.itemId);
  const leftNeighborId = useSlideEditPreviewStore((s) => s.leftNeighborId);
  const rightNeighborId = useSlideEditPreviewStore((s) => s.rightNeighborId);
  const slideDelta = useSlideEditPreviewStore((s) => s.slideDelta);
  const items = useTimelineStore((s) => s.items);

  const itemsMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  if (!itemId) return null;

  const slidItem = itemsMap.get(itemId);
  if (!slidItem) return null;

  const leftNeighbor = leftNeighborId ? (itemsMap.get(leftNeighborId) ?? null) : null;
  const rightNeighbor = rightNeighborId ? (itemsMap.get(rightNeighborId) ?? null) : null;

  // --- Corner thumbnails: slid clip's first and last frames (static) ---
  const firstFrameInfo = getSourceFrameInfo(slidItem, 0, fps);
  const lastFrameInfo = getSourceFrameInfo(
    slidItem,
    Math.max(0, slidItem.durationInFrames - 1),
    fps,
  );

  // --- Center-left (OUT): left neighbor's new last frame ---
  // The left neighbor extends or shrinks by slideDelta.
  // New last frame = original duration + slideDelta - 1
  const leftPanel = leftNeighbor
    ? (() => {
        const outLocalFrame = Math.max(0, leftNeighbor.durationInFrames + slideDelta - 1);
        const outInfo = getSourceFrameInfo(leftNeighbor, outLocalFrame, fps);
        return {
          item: leftNeighbor,
          sourceTime: outInfo.sourceTime,
          timecode: outInfo.timecode,
          label: 'OUT',
        };
      })()
    : {
        item: null as null,
        timecode: '--:--:--:--',
        label: 'OUT',
        placeholderText: 'GAP',
      };

  // --- Center-right (IN): right neighbor's new first frame ---
  // The right neighbor's start is trimmed by slideDelta (its source-visible
  // region shifts forward). The new first visible frame is at local slideDelta.
  const rightPanel = rightNeighbor
    ? (() => {
        const inLocalFrame = Math.max(0, slideDelta);
        const inInfo = getSourceFrameInfo(rightNeighbor, inLocalFrame, fps);
        return {
          item: rightNeighbor,
          sourceTime: inInfo.sourceTime,
          timecode: inInfo.timecode,
          label: 'IN',
        };
      })()
    : {
        item: null as null,
        timecode: '--:--:--:--',
        label: 'IN',
        placeholderText: 'GAP',
      };

  return (
    <EditFourUpPanels
      leftPanel={leftPanel}
      rightPanel={rightPanel}
      topLeftCorner={{
        item: slidItem,
        sourceTime: firstFrameInfo.sourceTime,
        timecode: firstFrameInfo.timecode,
        label: '',
      }}
      topRightCorner={{
        item: slidItem,
        sourceTime: lastFrameInfo.sourceTime,
        timecode: lastFrameInfo.timecode,
        label: '',
      }}
    />
  );
}
