import type { TimelineItem, Gap } from '@/types/timeline';

/**
 * Extended Gap type with track ID for track-specific gaps
 */
export interface TrackGap extends Gap {
  trackId: string;
}

/**
 * Find all gaps in the timeline, optionally filtered by track.
 * A gap is a period of time with no items on a track.
 *
 * @param items - All timeline items
 * @param trackId - Optional track ID to filter by. If not provided, finds gaps per track.
 * @returns Array of gaps with their positions and track IDs
 */
export function findGaps(items: TimelineItem[], trackId?: string): TrackGap[] {
  const gaps: TrackGap[] = [];

  // Filter items by track if specified
  const trackItems = trackId
    ? items.filter((item) => item.trackId === trackId)
    : items;

  // Group items by track
  const byTrack = new Map<string, TimelineItem[]>();
  for (const item of trackItems) {
    const list = byTrack.get(item.trackId) || [];
    list.push(item);
    byTrack.set(item.trackId, list);
  }

  // Find gaps per track
  for (const [currentTrackId, currentTrackItems] of byTrack) {
    // Sort items by position
    const sorted = [...currentTrackItems].sort((a, b) => a.from - b.from);

    // Check gap at start (from frame 0) - only if there are items
    if (sorted.length > 0 && sorted[0].from > 0) {
      gaps.push({
        start: 0,
        end: sorted[0].from,
        duration: sorted[0].from,
        trackId: currentTrackId,
      });
    }

    // Check gaps between items
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const currentEnd = current.from + current.durationInFrames;

      if (currentEnd < next.from) {
        gaps.push({
          start: currentEnd,
          end: next.from,
          duration: next.from - currentEnd,
          trackId: currentTrackId,
        });
      }
    }
  }

  return gaps;
}

/**
 * Calculate shift amounts for items based on gaps.
 * Items are shifted left to close gaps.
 *
 * @param items - Items to calculate shifts for
 * @param gaps - Gaps to close
 * @returns Array of items with updated positions
 */
export function removeGaps(
  items: TimelineItem[],
  trackId?: string
): TimelineItem[] {
  const gaps = findGaps(items, trackId);
  if (gaps.length === 0) return items;

  // Calculate cumulative shift per track
  const shiftByTrack = new Map<string, { position: number; shift: number }[]>();

  for (const gap of gaps) {
    const shifts = shiftByTrack.get(gap.trackId) || [];
    shifts.push({ position: gap.end, shift: gap.duration });
    shiftByTrack.set(gap.trackId, shifts);
  }

  // Apply shifts to items
  return items.map((item) => {
    const shifts = shiftByTrack.get(item.trackId);
    if (!shifts) return item;

    // Calculate total shift for this item's position
    const totalShift = shifts
      .filter((s) => s.position <= item.from)
      .reduce((sum, s) => sum + s.shift, 0);

    if (totalShift === 0) return item;

    return {
      ...item,
      from: item.from - totalShift,
    };
  });
}

/**
 * Remove only gaps before the first item on each track (ripple to start).
 *
 * @param items - All timeline items
 * @returns Items with leading gaps removed
 */
export function removeLeadingGaps(items: TimelineItem[]): TimelineItem[] {
  // Group items by track
  const byTrack = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const list = byTrack.get(item.trackId) || [];
    list.push(item);
    byTrack.set(item.trackId, list);
  }

  // Calculate shift per track (distance from frame 0 to first item)
  const shiftByTrack = new Map<string, number>();
  for (const [trackId, trackItems] of byTrack) {
    if (trackItems.length > 0) {
      const minFrom = Math.min(...trackItems.map((item) => item.from));
      if (minFrom > 0) {
        shiftByTrack.set(trackId, minFrom);
      }
    }
  }

  // Apply shifts
  return items.map((item) => {
    const shift = shiftByTrack.get(item.trackId);
    if (!shift) return item;

    return {
      ...item,
      from: item.from - shift,
    };
  });
}

// Note: removeGapAt functionality exists in timeline store as closeGapAtPosition

/**
 * Get total gap duration across all tracks or a specific track.
 *
 * @param items - All timeline items
 * @param trackId - Optional track ID to filter by
 * @returns Total duration of all gaps in frames
 */
export function getTotalGapDuration(
  items: TimelineItem[],
  trackId?: string
): number {
  const gaps = findGaps(items, trackId);
  return gaps.reduce((sum, gap) => sum + gap.duration, 0);
}

/**
 * Check if there are any gaps in the timeline.
 *
 * @param items - All timeline items
 * @param trackId - Optional track ID to filter by
 * @returns True if there are gaps
 */
export function hasGaps(items: TimelineItem[], trackId?: string): boolean {
  return findGaps(items, trackId).length > 0;
}
