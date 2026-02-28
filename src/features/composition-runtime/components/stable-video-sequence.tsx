/**
 * Stable Video Sequence
 *
 * A wrapper around Composition's Sequence that uses a stable key based on
 * originId for video items. This prevents video remounting when clips
 * are split, as split clips share the same originId.
 *
 * The key insight: React's reconciliation won't remount a component if
 * its key stays the same. By keying video Sequences by originId instead
 * of item.id, split clips reuse the same Sequence/video element.
 */

import React, { useMemo } from 'react';
import { Sequence, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { VideoItem } from '@/types/timeline';

/** Video item with additional properties added by MainComposition */
export type StableVideoSequenceItem = VideoItem & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
  _sequenceFrameOffset?: number;
  _poolClipId?: string;
};

interface StableVideoSequenceProps {
  /** All video items that might share the same origin */
  items: StableVideoSequenceItem[];
  /** Render function for the video content */
  renderItem: (item: StableVideoSequenceItem) => React.ReactNode;
  /** Number of frames to premount */
  premountFor?: number;
}

interface VideoGroup {
  originKey: string;
  items: StableVideoSequenceItem[];
  minFrom: number;
  maxEnd: number;
}

function findActiveItemIndex(items: StableVideoSequenceItem[], frame: number): number {
  let low = 0;
  let high = items.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const item = items[mid]!;
    const start = item.from;
    const end = item.from + item.durationInFrames;

    if (frame < start) {
      high = mid - 1;
      continue;
    }

    if (frame >= end) {
      low = mid + 1;
      continue;
    }

    // Overlap-aware tie-break:
    // If multiple clips are active at this frame (transition overlap), prefer
    // the right-most active clip (latest start). This prevents a base-layer
    // left->right handoff exactly at transition exit, which can leak as a
    // one-frame flicker if the transition overlay drops a frame.
    let rightmost = mid;
    while (rightmost + 1 < items.length) {
      const next = items[rightmost + 1]!;
      const nextStart = next.from;
      const nextEnd = next.from + next.durationInFrames;
      if (frame >= nextStart && frame < nextEnd) {
        rightmost += 1;
        continue;
      }
      break;
    }

    return rightmost;
  }

  return -1;
}

/**
 * Groups video items by their origin key (mediaId-originId) AND adjacency.
 * Only adjacent clips (one ends where another begins) are grouped together.
 * Clips that have been dragged apart are placed in separate groups.
 *
 * KEY STABILITY NOTES:
 * - Speed is NOT part of the key - changing speed should not cause remounts
 * - Position (minFrom) is NOT part of the key - rate stretch from start, trim,
 *   move, or undo should not cause remounts
 * - Uses first item's ID to differentiate sub-groups when clips are dragged apart
 * - This ensures Web Audio API connections stay intact across all operations
 *
 * RATE STRETCH HANDLING:
 * - Clips with non-default speed (speed != 1) are placed in their own groups
 * - This is because the sourceStart adjustment formula breaks for mixed-speed groups
 * - The formula (sourceStart - itemOffset * speed) produces negative values when
 *   a clip with speed > 1 is far from the group start
 */
function groupByOrigin(items: StableVideoSequenceItem[]): VideoGroup[] {
  // First, collect items by their origin key
  const byOriginKey = new Map<string, StableVideoSequenceItem[]>();

  for (const item of items) {
    const originId = item.originId || item.id;
    // NOTE: Do NOT include speed in the key - changing speed should NOT cause remount
    // Remounting breaks Web Audio API connections, causing audio to go silent
    // Speed changes are handled dynamically via playbackRate prop
    const key = `${item.mediaId}-${originId}`;

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
    // Sort by position (toSorted for immutability)
    const sorted = originItems.toSorted((a, b) => a.from - b.from);

    // Build contiguous groups - clips must be adjacent (no gap)
    let currentGroup: StableVideoSequenceItem[] = [sorted[0]!];
    let currentEnd = sorted[0]!.from + sorted[0]!.durationInFrames;

    for (let i = 1; i < sorted.length; i++) {
      const item = sorted[i]!;
      // Check if this item or any item in current group has non-default speed
      // Rate-stretched clips must be in their own group because the sourceStart
      // adjustment formula (sourceStart - itemOffset * speed) breaks when clips
      // have different speeds - it can produce negative sourceStart values
      const itemHasCustomSpeed = (item.speed ?? 1) !== 1;
      const groupHasCustomSpeed = currentGroup.some(g => (g.speed ?? 1) !== 1);
      const speedMismatch = itemHasCustomSpeed || groupHasCustomSpeed;

      // Adjacent if this item starts where previous ends (allow 1 frame tolerance for rounding)
      // BUT also require same speed to be grouped together
      if (item.from <= currentEnd + 1 && !speedMismatch) {
        currentGroup.push(item);
        currentEnd = Math.max(currentEnd, item.from + item.durationInFrames);
      } else {
        // Gap detected - finalize current group and start new one
        const minFrom = Math.min(...currentGroup.map((i) => i.from));
        const maxEnd = Math.max(...currentGroup.map((i) => i.from + i.durationInFrames));
        // Use first item's ID for stable key - doesn't change when position changes
        // (minFrom would change on rate stretch from start, trim, or move, causing remount)
        const firstItemId = currentGroup[0]!.id;
        groups.push({
          originKey: `${originKey}-${firstItemId}`,
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
    // Use first item's ID for stable key - doesn't change when position changes
    const firstItemId = currentGroup[0]!.id;
    groups.push({
      originKey: `${originKey}-${firstItemId}`,
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
/**
 * Custom comparison for GroupRenderer to ensure re-render when item properties change.
 * Default React.memo shallow comparison only checks reference equality, which may miss
 * cases where group.items contains items with changed properties (like speed after rate stretch).
 */
function areGroupPropsEqual(
  prevProps: { group: VideoGroup; renderItem: (item: StableVideoSequenceItem) => React.ReactNode },
  nextProps: { group: VideoGroup; renderItem: (item: StableVideoSequenceItem) => React.ReactNode }
): boolean {
  // Quick reference check first
  if (prevProps.group === nextProps.group && prevProps.renderItem === nextProps.renderItem) {
    return true;
  }

  // If renderItem changed, need to re-render
  if (prevProps.renderItem !== nextProps.renderItem) {
    return false;
  }

  // Check if group structure changed
  if (prevProps.group.originKey !== nextProps.group.originKey ||
      prevProps.group.minFrom !== nextProps.group.minFrom ||
      prevProps.group.maxEnd !== nextProps.group.maxEnd ||
      prevProps.group.items.length !== nextProps.group.items.length) {
    return false;
  }

  // Deep check: compare item properties that affect rendering
  for (let i = 0; i < prevProps.group.items.length; i++) {
    const prevItem = prevProps.group.items[i]!;
    const nextItem = nextProps.group.items[i]!;
    if (prevItem.id !== nextItem.id ||
        prevItem.speed !== nextItem.speed ||
        prevItem.sourceStart !== nextItem.sourceStart ||
        prevItem.sourceEnd !== nextItem.sourceEnd ||
        prevItem.from !== nextItem.from ||
        prevItem.durationInFrames !== nextItem.durationInFrames ||
        prevItem.trackVisible !== nextItem.trackVisible ||
        prevItem.muted !== nextItem.muted) {
      return false;
    }
  }

  return true;
}

const GroupRenderer: React.FC<{
  group: VideoGroup;
  renderItem: (item: StableVideoSequenceItem) => React.ReactNode;
}> = React.memo(({ group, renderItem }) => {
  // Get local frame from Sequence context (0-based within this Sequence)
  // The Sequence component provides this via SequenceContext
  const sequenceContext = useSequenceContext();
  const localFrame = sequenceContext?.localFrame ?? 0;

  // CRITICAL: Don't render during premount phase (localFrame < 0)
  // Premount is for keeping React tree mounted, not for showing content.
  // Without this check, clips with gaps would show their start frame
  // before the playhead actually reaches them.
  const isPremounted = localFrame < 0;

  // Convert to global frame for comparison with item.from (which is global)
  const globalFrame = localFrame + group.minFrom;

  // Find the active item ID for current frame
  // During premount, don't find any active item - we shouldn't render.
  const activeItemIndex = isPremounted ? -1 : findActiveItemIndex(group.items, globalFrame);
  const activeItem = activeItemIndex >= 0 ? group.items[activeItemIndex] : null;

  // Memoize the adjusted item based on active item identity.
  // Only recalculates when crossing split boundaries or when item/group properties change.
  const adjustedItem = useMemo(() => {
    if (!activeItem) return null;

    // Keep source metadata absolute/stable.
    // Shared Sequence frame-origin differences are handled downstream via
    // _sequenceFrameOffset in video timing calculations.
    const itemOffset = activeItem.from - group.minFrom;

    return {
      ...activeItem,
      // Pass the frame offset so fades can be calculated correctly within shared Sequences
      // Without this, useCurrentFrame() returns the frame relative to the shared Sequence,
      // not relative to this specific item, causing fades to misbehave on split clips
      _sequenceFrameOffset: itemOffset,
      // Keep a stable pool identity across split boundaries so preview video
      // playback does not release/reacquire the element on item.id changes.
      _poolClipId: `group-${group.originKey}`,
    };
  }, [activeItem, group.minFrom]);

  // CRITICAL: Also memoize the RENDERED OUTPUT.
  // This prevents calling renderItem (which creates new React elements) every frame.
  // Without this, canvas-based effects like halftone would re-render on every frame.
  const renderedContent = useMemo(() => {
    if (!adjustedItem) return null;
    return renderItem(adjustedItem);
  }, [adjustedItem, renderItem]);

  return <>{renderedContent}</>;
}, areGroupPropsEqual);

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
