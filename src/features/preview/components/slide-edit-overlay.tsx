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
 * Corner thumbnails (small, static baseline):
 *   - Top-left:  left neighbor's current OUT frame before drag delta
 *   - Top-right: right neighbor's current IN frame before drag delta
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

  // --- Corner thumbnails: current baseline before drag delta ---
  const topLeftCorner = leftNeighbor
    ? (() => {
        const outLocalFrame = Math.max(0, leftNeighbor.durationInFrames - 1);
        const outInfo = getSourceFrameInfo(leftNeighbor, outLocalFrame, fps);
        return {
          item: leftNeighbor,
          sourceTime: outInfo.sourceTime,
          timecode: outInfo.timecode,
          label: '',
        };
      })()
    : undefined;

  const topRightCorner = rightNeighbor
    ? (() => {
        const inInfo = getSourceFrameInfo(rightNeighbor, 0, fps);
        return {
          item: rightNeighbor,
          sourceTime: inInfo.sourceTime,
          timecode: inInfo.timecode,
          label: '',
        };
      })()
    : undefined;

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
  // The right neighbor's start is trimmed by slideDelta. When positive,
  // the start shrinks (later source content). When negative, the start
  // extends (earlier source content). Local frame = slideDelta in both cases;
  // getSourceFrameInfo + VideoFrame handle sub-zero source times via clamping.
  const rightPanel = rightNeighbor
    ? (() => {
        const inLocalFrame = slideDelta;
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
      topLeftCorner={topLeftCorner}
      topRightCorner={topRightCorner}
    />
  );
}
