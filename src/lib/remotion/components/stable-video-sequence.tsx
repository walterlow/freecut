/**
 * Stable Video Sequence
 *
 * A wrapper around Remotion's Sequence that uses a stable key based on
 * originId for video items. This prevents video remounting when clips
 * are split, as split clips share the same originId.
 *
 * The key insight: React's reconciliation won't remount a component if
 * its key stays the same. By keying video Sequences by originId instead
 * of item.id, split clips reuse the same Sequence/video element.
 */

import React, { useMemo } from 'react';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VideoItem } from '@/types/timeline';

/** Video item with additional properties added by MainComposition */
type EnrichedVideoItem = VideoItem & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};

interface StableVideoSequenceProps {
  /** All video items that might share the same origin */
  items: EnrichedVideoItem[];
  /** Render function for the video content */
  renderItem: (item: EnrichedVideoItem) => React.ReactNode;
  /** Number of frames to premount */
  premountFor?: number;
}

interface VideoGroup {
  originKey: string;
  items: EnrichedVideoItem[];
  minFrom: number;
  maxEnd: number;
}

/**
 * Groups video items by their origin key (mediaId-originId-speed) AND adjacency.
 * Only adjacent clips (one ends where another begins) are grouped together.
 * Clips that have been dragged apart are placed in separate groups.
 */
function groupByOrigin(items: EnrichedVideoItem[]): VideoGroup[] {
  // First, collect items by their origin key
  const byOriginKey = new Map<string, EnrichedVideoItem[]>();

  for (const item of items) {
    const originId = item.originId || item.id;
    const key = `${item.mediaId}-${originId}-${item.speed || 1}`;

    const existing = byOriginKey.get(key);
    if (existing) {
      existing.push(item);
    } else {
      byOriginKey.set(key, [item]);
    }
  }

  // Now split each origin group into contiguous sub-groups
  const groups: VideoGroup[] = [];

  for (const [originKey, originItems] of byOriginKey) {
    // Sort by position
    const sorted = [...originItems].sort((a, b) => a.from - b.from);

    // Build contiguous groups - clips must be adjacent (no gap)
    let currentGroup: EnrichedVideoItem[] = [sorted[0]!];
    let currentEnd = sorted[0]!.from + sorted[0]!.durationInFrames;

    for (let i = 1; i < sorted.length; i++) {
      const item = sorted[i]!;
      // Adjacent if this item starts where previous ends (allow 1 frame tolerance for rounding)
      if (item.from <= currentEnd + 1) {
        currentGroup.push(item);
        currentEnd = Math.max(currentEnd, item.from + item.durationInFrames);
      } else {
        // Gap detected - finalize current group and start new one
        const minFrom = Math.min(...currentGroup.map((i) => i.from));
        const maxEnd = Math.max(...currentGroup.map((i) => i.from + i.durationInFrames));
        groups.push({
          originKey: `${originKey}-${minFrom}`, // Make key unique per sub-group
          items: currentGroup,
          minFrom,
          maxEnd,
        });
        currentGroup = [item];
        currentEnd = item.from + item.durationInFrames;
      }
    }

    // Finalize last group
    const minFrom = Math.min(...currentGroup.map((i) => i.from));
    const maxEnd = Math.max(...currentGroup.map((i) => i.from + i.durationInFrames));
    groups.push({
      originKey: `${originKey}-${minFrom}`,
      items: currentGroup,
      minFrom,
      maxEnd,
    });
  }

  return groups;
}

/**
 * Renders the active item from a group based on current frame.
 *
 * CRITICAL for halftone/canvas effects:
 * 1. Memoizes adjustedItem so it only changes when crossing split boundaries
 * 2. Memoizes the RENDERED OUTPUT so renderItem isn't called every frame
 * This prevents re-renders of canvas-based effects like halftone on every frame.
 */
const GroupRenderer: React.FC<{
  group: VideoGroup;
  renderItem: (item: EnrichedVideoItem) => React.ReactNode;
}> = React.memo(({ group, renderItem }) => {
  // useCurrentFrame() returns LOCAL frame relative to the Sequence's `from`
  const localFrame = useCurrentFrame();
  // Convert to global frame for comparison with item.from (which is global)
  const globalFrame = localFrame + group.minFrom;

  // Find the active item for current frame
  const activeItem = group.items.find(
    (item) => globalFrame >= item.from && globalFrame < item.from + item.durationInFrames
  );

  // Memoize the adjusted item based on active item's identity.
  // Only recalculates when crossing split boundaries.
  const adjustedItem = useMemo(() => {
    if (!activeItem) return null;

    // Adjust sourceStart to account for the shared Sequence.
    // In a shared Sequence, localFrame is relative to group.minFrom, not item.from.
    // OffthreadVideo uses: startFrom + localFrame * playbackRate for source position
    // We need: sourceStart + (globalFrame - item.from) * speed
    //        = sourceStart + (localFrame - itemOffset) * speed
    //        = sourceStart - itemOffset * speed + localFrame * speed
    // So: adjustedSourceStart = sourceStart - itemOffset * speed
    const itemOffset = activeItem.from - group.minFrom;
    const speed = activeItem.speed || 1;
    // For source position adjustments, multiply by speed since sourceStart is in source frames
    // but itemOffset is in timeline frames
    // IMPORTANT: Round to match how splitItem calculates sourceStart (uses Math.round)
    // Without rounding, floating point errors cause fractional sourceStart values
    const sourceFrameOffset = Math.round(itemOffset * speed);
    return {
      ...activeItem,
      sourceStart: (activeItem.sourceStart ?? 0) - sourceFrameOffset,
      trimStart: activeItem.trimStart != null ? activeItem.trimStart - sourceFrameOffset : undefined,
      offset: activeItem.offset != null ? activeItem.offset - sourceFrameOffset : undefined,
      // Pass the frame offset so fades can be calculated correctly within shared Sequences
      // Without this, useCurrentFrame() returns the frame relative to the shared Sequence,
      // not relative to this specific item, causing fades to misbehave on split clips
      _sequenceFrameOffset: itemOffset,
    };
  }, [activeItem?.id, activeItem, group.minFrom]);

  // CRITICAL: Also memoize the RENDERED OUTPUT.
  // This prevents calling renderItem (which creates new React elements) every frame.
  // Without this, canvas-based effects like halftone would re-render on every frame.
  const renderedContent = useMemo(() => {
    if (!adjustedItem) return null;
    return renderItem(adjustedItem);
  }, [adjustedItem, renderItem]);

  return <>{renderedContent}</>;
});

GroupRenderer.displayName = 'GroupRenderer';

/**
 * Renders video items with stable keys based on origin.
 *
 * Items sharing the same originId are grouped into a single Sequence
 * with a stable key. This prevents remounting when clips are split.
 */
export const StableVideoSequence: React.FC<StableVideoSequenceProps> = ({
  items,
  renderItem,
  premountFor = 0,
}) => {
  const { fps } = useVideoConfig();
  const defaultPremount = premountFor || Math.round(fps * 2);

  const groups = useMemo(() => groupByOrigin(items), [items]);

  return (
    <>
      {groups.map((group) => (
        <Sequence
          key={group.originKey} // Stable key - doesn't change on split!
          from={group.minFrom}
          durationInFrames={group.maxEnd - group.minFrom}
          premountFor={defaultPremount}
        >
          <GroupRenderer group={group} renderItem={renderItem} />
        </Sequence>
      ))}
    </>
  );
};
