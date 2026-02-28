import { useMemo } from 'react';
import {
  useTimelineStore,
} from '@/features/preview/deps/timeline-store';
import { useSlipEditPreviewStore } from '@/features/preview/deps/timeline-edit-preview';
import { EditFourUpPanels } from './edit-4up-panels';
import { getSourceFrameInfo } from './edit-overlay-utils';

interface SlipEditOverlayProps {
  fps: number;
}

/**
 * 4-up overlay shown during slip edits.
 *
 * Center panels (large, dynamic):
 * - Left:  Slipped clip's new IN frame (sourceStart + slipDelta at local frame 0)
 * - Right: Slipped clip's new OUT frame (sourceStart + slipDelta at local frame durationInFrames - 1)
 *
 * Corner thumbnails (small, static baseline):
 * - Top-left:  Slipped clip's current IN frame before drag delta
 * - Top-right: Slipped clip's current OUT frame before drag delta
 */
export function SlipEditOverlay({ fps }: SlipEditOverlayProps) {
  const itemId = useSlipEditPreviewStore((s) => s.itemId);
  const slipDelta = useSlipEditPreviewStore((s) => s.slipDelta);
  const items = useTimelineStore((s) => s.items);

  const itemsMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const slippedItem = itemId ? (itemsMap.get(itemId) ?? null) : null;

  if (!slippedItem) return null;

  const outLocalFrame = Math.max(0, slippedItem.durationInFrames - 1);

  // Baseline (pre-drag): slipped clip's currently committed IN/OUT.
  const currentInInfo = getSourceFrameInfo(slippedItem, 0, fps);
  const currentOutInfo = getSourceFrameInfo(slippedItem, outLocalFrame, fps);

  // Create a virtual item with sourceStart/sourceEnd shifted by slipDelta
  // so getSourceFrameInfo seeks to the correct slipped source time.
  const virtualItem = {
    ...slippedItem,
    sourceStart: (slippedItem.sourceStart ?? 0) + slipDelta,
    sourceEnd:
      slippedItem.sourceEnd !== undefined
        ? slippedItem.sourceEnd + slipDelta
        : undefined,
  };

  // Center-left: new IN frame (local frame 0)
  const inInfo = getSourceFrameInfo(virtualItem, 0, fps);

  // Center-right: new OUT frame (local frame durationInFrames - 1)
  const outInfo = getSourceFrameInfo(virtualItem, outLocalFrame, fps);

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
      topLeftCorner={{
        item: slippedItem,
        sourceTime: currentInInfo.sourceTime,
        timecode: currentInInfo.timecode,
        label: '',
      }}
      topRightCorner={{
        item: slippedItem,
        sourceTime: currentOutInfo.sourceTime,
        timecode: currentOutInfo.timecode,
        label: '',
      }}
    />
  );
}

