import { useMemo } from 'react';
import {
  useTimelineStore,
} from '@/features/preview/deps/timeline-store';
import { useRollingEditPreviewStore } from '@/features/preview/deps/timeline-edit-preview';
import { EditTwoUpPanels } from './edit-2up-panels';
import { getSourceFrameInfo } from './edit-overlay-utils';

interface RollingEditOverlayProps {
  fps: number;
}

/**
 * 2-up frame comparison shown during rolling edits.
 */
export function RollingEditOverlay({ fps }: RollingEditOverlayProps) {
  const trimmedItemId = useRollingEditPreviewStore((s) => s.trimmedItemId);
  const neighborItemId = useRollingEditPreviewStore((s) => s.neighborItemId);
  const handle = useRollingEditPreviewStore((s) => s.handle);
  const neighborDelta = useRollingEditPreviewStore((s) => s.neighborDelta);
  const items = useTimelineStore((s) => s.items);
  const itemsMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  if (!trimmedItemId || !neighborItemId || !handle) return null;

  const trimmedItem = itemsMap.get(trimmedItemId);
  const neighborItem = itemsMap.get(neighborItemId);
  if (!trimmedItem || !neighborItem) return null;

  const leftItem = handle === 'end' ? trimmedItem : neighborItem;
  const rightItem = handle === 'end' ? neighborItem : trimmedItem;

  const editPointFrame =
    handle === 'end'
      ? leftItem.from + leftItem.durationInFrames + neighborDelta
      : rightItem.from + neighborDelta;

  const outLocalFrame = Math.max(0, editPointFrame - leftItem.from - 1);
  const inLocalFrame = Math.max(0, editPointFrame - rightItem.from);

  const outInfo = getSourceFrameInfo(leftItem, outLocalFrame, fps);
  const inInfo = getSourceFrameInfo(rightItem, inLocalFrame, fps);

  return (
    <EditTwoUpPanels
      leftPanel={{
        item: leftItem,
        sourceTime: outInfo.sourceTime,
        timecode: outInfo.timecode,
        label: 'OUT',
      }}
      rightPanel={{
        item: rightItem,
        sourceTime: inInfo.sourceTime,
        timecode: inInfo.timecode,
        label: 'IN',
      }}
    />
  );
}

