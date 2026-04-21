import { useCallback, useMemo, useRef } from 'react';
import { Image, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem, ImageItem } from '@/types/timeline';
import {
  captureSnapshot,
  rateStretchItemWithoutHistory,
  useTimelineCommandStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
} from '../components';
import { getMixedValue } from '../utils';

// Speed limits (matching rate-stretch)
const MIN_SPEED = 0.1;
const MAX_SPEED = 10.0;

interface GifSectionProps {
  items: TimelineItem[];
}

/**
 * Check if an image item is an animated image (GIF or WebP) based on its label
 */
function isAnimatedImageItem(item: TimelineItem): item is ImageItem {
  if (item.type !== 'image') return false;
  const label = item.label?.toLowerCase() ?? '';
  return label.endsWith('.gif') || label.endsWith('.webp');
}

/**
 * Animation section - playback speed for animated GIFs and animated WebP.
 * Only shown when selection includes animated image clips.
 *
 * Unlike videos, animated image speed changes don't affect duration (they loop):
 * - Faster speed = animation plays faster within same duration
 * - Slower speed = animation plays slower within same duration
 */
export function GifSection({ items }: GifSectionProps) {
  const gifItems = useMemo(
    () => items.filter(isAnimatedImageItem),
    [items]
  );

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => gifItems.map((item) => item.id), [gifItems]);
  const speedDragSnapshotRef = useRef<ReturnType<typeof captureSnapshot> | null>(null);

  // Get current speed (defaults to 1)
  const speed = getMixedValue(gifItems, (item) => item.speed, 1);

  const applySpeedChangeWithoutHistory = useCallback(
    (newSpeed: number) => {
      // Round to 2 decimal places to match clip label precision and avoid floating point drift
      const roundedSpeed = Math.round(newSpeed * 100) / 100;
      // Clamp speed to valid range
      const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, roundedSpeed));

      const currentItems = useTimelineStore.getState().items;
      currentItems
        .filter((item: TimelineItem): item is ImageItem => isAnimatedImageItem(item) && itemIds.includes(item.id))
        .forEach((item: ImageItem) => {
          rateStretchItemWithoutHistory(item.id, item.from, item.durationInFrames, clampedSpeed);
        });

      return clampedSpeed;
    },
    [itemIds]
  );

  const commitSpeedChange = useCallback(
    (newSpeed: number) => {
      const beforeSnapshot = speedDragSnapshotRef.current ?? captureSnapshot();
      const clampedSpeed = applySpeedChangeWithoutHistory(newSpeed);
      useTimelineCommandStore.getState().addUndoEntry(
        {
          type: 'RATE_STRETCH_ITEM',
          payload: { ids: itemIds, newSpeed: clampedSpeed },
        },
        beforeSnapshot
      );
      speedDragSnapshotRef.current = null;
    },
    [applySpeedChangeWithoutHistory, itemIds]
  );

  const handleSpeedLiveChange = useCallback(
    (newSpeed: number) => {
      if (!speedDragSnapshotRef.current) {
        speedDragSnapshotRef.current = captureSnapshot();
      }
      applySpeedChangeWithoutHistory(newSpeed);
    },
    [applySpeedChangeWithoutHistory]
  );

  // Reset speed to 1x
  const handleResetSpeed = useCallback(() => {
    const tolerance = 0.01;
    const needsReset = useTimelineStore.getState().items.some(
      (item: TimelineItem) =>
        isAnimatedImageItem(item)
        && itemIds.includes(item.id)
        && Math.abs((item.speed || 1) - 1) > tolerance
    );
    if (!needsReset) return;

    commitSpeedChange(1);
  }, [commitSpeedChange, itemIds]);

  if (gifItems.length === 0) return null;

  return (
    <PropertySection title="Animation" icon={Image} defaultOpen={true}>
      {/* Playback Speed - affects animation rate (not duration) */}
      <PropertyRow label="Speed">
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={speed}
            onChange={commitSpeedChange}
            onLiveChange={handleSpeedLiveChange}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.1}
            unit="x"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetSpeed}
            title="Reset to 1x"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>
    </PropertySection>
  );
}
