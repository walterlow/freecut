import type { TimelineItem } from '@/types/timeline';

/**
 * Collision detection utilities for timeline drag-and-drop
 * Pure functions for overlap detection and push-forward calculations
 */

/**
 * Check if two time ranges overlap
 *
 * @param start1 - Start of first range
 * @param end1 - End of first range
 * @param start2 - Start of second range
 * @param end2 - End of second range
 * @returns True if ranges overlap
 */
export function rangesOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): boolean {
  // Ranges overlap if: start1 < end2 AND start2 < end1
  return start1 < end2 && start2 < end1;
}

/**
 * Check if two items overlap in time
 *
 * @param item1 - First item
 * @param item2 - Second item
 * @returns True if items overlap
 */
export function itemsOverlap(item1: TimelineItem, item2: TimelineItem): boolean {
  const end1 = item1.from + item1.durationInFrames;
  const end2 = item2.from + item2.durationInFrames;
  return rangesOverlap(item1.from, end1, item2.from, end2);
}

/**
 * Find all items that would overlap with a moved item
 *
 * @param movedItemId - ID of item being moved
 * @param newFrom - New start frame of moved item
 * @param durationInFrames - Duration of moved item
 * @param targetTrackId - Target track ID
 * @param allItems - All timeline items
 * @param excludeItemIds - Item IDs to exclude from collision detection (e.g., multi-select group)
 * @returns Array of overlapping items
 */
export function findOverlappingItems(
  movedItemId: string,
  newFrom: number,
  durationInFrames: number,
  targetTrackId: string,
  allItems: TimelineItem[],
  excludeItemIds: string[] = []
): TimelineItem[] {
  const movedEnd = newFrom + durationInFrames;

  return allItems.filter((item) => {
    // Skip the moved item itself
    if (item.id === movedItemId) return false;

    // Skip excluded items (e.g., other items in multi-select)
    if (excludeItemIds.includes(item.id)) return false;

    // Only check items on the same track
    if (item.trackId !== targetTrackId) return false;

    // Check if time ranges overlap
    const itemEnd = item.from + item.durationInFrames;
    return rangesOverlap(newFrom, movedEnd, item.from, itemEnd);
  });
}

/**
 * Calculate new positions for items that need to be pushed forward
 * Uses a greedy algorithm: push items to just after the blocking item
 *
 * @param overlappingItems - Items that would overlap
 * @param blockingEndFrame - Frame where the blocking item ends
 * @returns Array of item updates (id + new from position)
 */
export function calculatePushPositions(
  overlappingItems: TimelineItem[],
  blockingEndFrame: number
): Array<{ id: string; from: number }> {
  if (overlappingItems.length === 0) return [];

  // Sort items by their current start frame
  const sorted = [...overlappingItems].sort((a, b) => a.from - b.from);

  const updates: Array<{ id: string; from: number }> = [];
  let nextAvailableFrame = blockingEndFrame;

  for (const item of sorted) {
    // If this item would overlap with the next available position, push it
    if (item.from < nextAvailableFrame) {
      updates.push({
        id: item.id,
        from: nextAvailableFrame,
      });
      nextAvailableFrame = nextAvailableFrame + item.durationInFrames;
    } else {
      // Item doesn't need to move, but update next available for cascade
      nextAvailableFrame = item.from + item.durationInFrames;
    }
  }

  return updates;
}

/**
 * Recursively resolve all collisions caused by pushing items
 * Handles cascade effects where pushed items push other items
 *
 * @param initialPushes - Initial push updates
 * @param trackId - Track being modified
 * @param allItems - All timeline items
 * @param excludeItemIds - Items to exclude from collision (being dragged)
 * @returns Final resolved positions for all affected items
 */
export function resolveCollisionsCascade(
  initialPushes: Array<{ id: string; from: number }>,
  trackId: string,
  allItems: TimelineItem[],
  excludeItemIds: string[] = []
): Array<{ id: string; from: number }> {
  const finalPositions = new Map<string, number>();
  const processedIds = new Set<string>(excludeItemIds);

  // Initialize with initial pushes
  for (const push of initialPushes) {
    finalPositions.set(push.id, push.from);
  }

  // Keep processing until no more collisions
  let hasChanges = true;
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Prevent infinite loops

  while (hasChanges && iterations < MAX_ITERATIONS) {
    hasChanges = false;
    iterations++;

    // Check each pushed item for new collisions
    for (const [itemId, newFrom] of finalPositions) {
      if (processedIds.has(itemId)) continue;

      const item = allItems.find((i) => i.id === itemId);
      if (!item) continue;

      // Find what this pushed item would now collide with
      const newCollisions = findOverlappingItems(
        itemId,
        newFrom,
        item.durationInFrames,
        trackId,
        allItems,
        Array.from(processedIds)
      );

      if (newCollisions.length > 0) {
        // Calculate push for these new collisions
        const blockingEnd = newFrom + item.durationInFrames;
        const newPushes = calculatePushPositions(newCollisions, blockingEnd);

        // Add to final positions
        for (const push of newPushes) {
          if (!finalPositions.has(push.id)) {
            finalPositions.set(push.id, push.from);
            hasChanges = true;
          }
        }
      }

      processedIds.add(itemId);
    }
  }

  // Convert map to array
  return Array.from(finalPositions.entries()).map(([id, from]) => ({ id, from }));
}

/**
 * Sort items by start frame
 * Useful for gap detection and sequential operations
 *
 * @param items - Items to sort
 * @returns Sorted items (does not mutate original)
 */
export function sortItemsByStartFrame(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => a.from - b.from);
}

/**
 * Validate if a position would cause overlap
 * Simple check without calculating pushes
 *
 * @param itemId - Item being moved
 * @param newFrom - Proposed new position
 * @param duration - Item duration
 * @param trackId - Target track
 * @param allItems - All timeline items
 * @returns True if position would cause overlap
 */
export function wouldCauseOverlap(
  itemId: string,
  newFrom: number,
  duration: number,
  trackId: string,
  allItems: TimelineItem[]
): boolean {
  const overlapping = findOverlappingItems(
    itemId,
    newFrom,
    duration,
    trackId,
    allItems
  );
  return overlapping.length > 0;
}

/**
 * Find the nearest available space for an item on a track
 * Snaps FORWARD to after any colliding items (never backward/swap)
 *
 * @param proposedFrom - Desired start position
 * @param durationInFrames - Duration of item to place
 * @param trackId - Target track ID
 * @param allItems - All timeline items
 * @returns Available position (snapped forward if collision) or null if no space
 */
export function findNearestAvailableSpace(
  proposedFrom: number,
  durationInFrames: number,
  trackId: string,
  allItems: TimelineItem[]
): number | null {
  // Get all items on this track, sorted by start frame
  const trackItems = allItems
    .filter(item => item.trackId === trackId)
    .sort((a, b) => a.from - b.from);

  // Start from proposed position and keep moving forward until we find space
  let testPosition = proposedFrom;
  const MAX_ITERATIONS = 1000; // Prevent infinite loops
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Check if current position would collide
    const collision = trackItems.find(item => {
      const itemEnd = item.from + item.durationInFrames;
      const testEnd = testPosition + durationInFrames;
      return rangesOverlap(testPosition, testEnd, item.from, itemEnd);
    });

    if (!collision) {
      // No collision - this position is available
      return testPosition;
    }

    // Collision found - snap to end of the colliding item
    testPosition = collision.from + collision.durationInFrames;
  }

  // If we've iterated too many times, something is wrong
  console.error('findNearestAvailableSpace: too many iterations, aborting');
  return null;
}
