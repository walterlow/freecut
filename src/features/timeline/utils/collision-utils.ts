import type { TimelineItem } from '@/types/timeline';

/**
 * Collision detection utilities for timeline drag-and-drop
 * Pure functions for overlap detection and push-forward calculations
 */

export interface CollisionRect {
  trackId: string;
  from: number;
  durationInFrames: number;
}

/**
 * Check if two time ranges overlap
 *
 * @param start1 - Start of first range
 * @param end1 - End of first range
 * @param start2 - Start of second range
 * @param end2 - End of second range
 * @returns True if ranges overlap
 */
function rangesOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): boolean {
  // Ranges overlap if: start1 < end2 AND start2 < end1
  return start1 < end2 && start2 < end1;
}

/**
 * Check if a position has enough space for an item (no collisions)
 *
 * @param position - Start position to check
 * @param durationInFrames - Duration of item to place
 * @param trackItems - Items on the track (sorted by start frame)
 * @returns True if the position has no collisions
 */
function hasAvailableSpace(
  position: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>
): boolean {
  const testEnd = position + durationInFrames;
  return !trackItems.some(item => {
    const itemEnd = item.from + item.durationInFrames;
    return rangesOverlap(position, testEnd, item.from, itemEnd);
  });
}

/**
 * Find available space by snapping backward (before the colliding item)
 *
 * @param proposedFrom - Desired start position
 * @param durationInFrames - Duration of item to place
 * @param trackItems - Items on the track (sorted by start frame)
 * @returns Available position snapped backward, or null if no space
 */
function findSpaceBackward(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>
): number | null {
  // Find the item we're colliding with
  const proposedEnd = proposedFrom + durationInFrames;
  const collision = trackItems.find(item => {
    const itemEnd = item.from + item.durationInFrames;
    return rangesOverlap(proposedFrom, proposedEnd, item.from, itemEnd);
  });

  if (!collision) {
    // No collision - original position is fine
    return proposedFrom;
  }

  // Try snapping to just before the colliding item
  const snapBackPosition = collision.from - durationInFrames;

  // Can't go below frame 0
  if (snapBackPosition < 0) {
    return null;
  }

  // Check if this position is available (no collision with previous items)
  if (hasAvailableSpace(snapBackPosition, durationInFrames, trackItems)) {
    return snapBackPosition;
  }

  return null;
}

/**
 * Find available space by snapping forward (after the colliding item)
 *
 * @param proposedFrom - Desired start position
 * @param durationInFrames - Duration of item to place
 * @param trackItems - Items on the track (sorted by start frame)
 * @returns Available position snapped forward, or null if no space
 */
function findSpaceForward(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>
): number | null {
  let testPosition = proposedFrom;
  const MAX_ITERATIONS = 1000;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const collision = trackItems.find(item => {
      const itemEnd = item.from + item.durationInFrames;
      const testEnd = testPosition + durationInFrames;
      return rangesOverlap(testPosition, testEnd, item.from, itemEnd);
    });

    if (!collision) {
      return testPosition;
    }

    // Snap to end of colliding item
    testPosition = collision.from + collision.durationInFrames;
  }

  console.error('findSpaceForward: too many iterations, aborting');
  return null;
}

/**
 * Find the nearest available space for an item on a track
 * Snaps to the closest edge (backward or forward) based on distance,
 * checking if space is available in that direction first.
 *
 * @param proposedFrom - Desired start position
 * @param durationInFrames - Duration of item to place
 * @param trackId - Target track ID
 * @param allItems - All timeline items
 * @returns Available position (snapped to closest edge) or null if no space in either direction
 */
export function findNearestAvailableSpace(
  proposedFrom: number,
  durationInFrames: number,
  trackId: string,
  allItems: ReadonlyArray<CollisionRect | TimelineItem>
): number | null {
  // Get all items on this track, sorted by start frame
  const trackItems = allItems
    .filter(item => item.trackId === trackId)
    .sort((a, b) => a.from - b.from);

  // If no collision, return proposed position
  if (hasAvailableSpace(proposedFrom, durationInFrames, trackItems)) {
    return proposedFrom;
  }

  // Find collision to determine distances
  const proposedEnd = proposedFrom + durationInFrames;
  const collision = trackItems.find(item => {
    const itemEnd = item.from + item.durationInFrames;
    return rangesOverlap(proposedFrom, proposedEnd, item.from, itemEnd);
  });

  if (!collision) {
    // Shouldn't happen since hasAvailableSpace returned false, but handle it
    return proposedFrom;
  }

  // Calculate distances to both edges
  const collisionEnd = collision.from + collision.durationInFrames;
  const distanceToBackEdge = proposedFrom - (collision.from - durationInFrames);
  const distanceToFrontEdge = collisionEnd - proposedFrom;

  // Try the closer edge first
  if (distanceToBackEdge <= distanceToFrontEdge) {
    // Try backward first
    const backwardPosition = findSpaceBackward(proposedFrom, durationInFrames, trackItems);
    if (backwardPosition !== null) {
      return backwardPosition;
    }
    // Backward not available, try forward
    return findSpaceForward(proposedFrom, durationInFrames, trackItems);
  } else {
    // Try forward first
    const forwardPosition = findSpaceForward(proposedFrom, durationInFrames, trackItems);
    if (forwardPosition !== null) {
      return forwardPosition;
    }
    // Forward not available, try backward
    return findSpaceBackward(proposedFrom, durationInFrames, trackItems);
  }
}
