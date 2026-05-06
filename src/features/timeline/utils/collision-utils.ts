import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('CollisionUtils')

/**
 * Collision detection utilities for timeline drag-and-drop
 * Pure functions for overlap detection and push-forward calculations
 */

export interface CollisionRect {
  trackId: string
  from: number
  durationInFrames: number
}

const EMPTY_TRACK_ITEMS: CollisionRect[] = []

function compareCollisionRectsByFrom(a: CollisionRect, b: CollisionRect): number {
  return a.from - b.from
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
function rangesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  // Ranges overlap if: start1 < end2 AND start2 < end1
  return start1 < end2 && start2 < end1
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
  trackItems: ReadonlyArray<CollisionRect>,
): boolean {
  const testEnd = position + durationInFrames
  return !trackItems.some((item) => {
    const itemEnd = item.from + item.durationInFrames
    return rangesOverlap(position, testEnd, item.from, itemEnd)
  })
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
  trackItems: ReadonlyArray<CollisionRect>,
): number | null {
  // Find the item we're colliding with
  const proposedEnd = proposedFrom + durationInFrames
  const collision = trackItems.find((item) => {
    const itemEnd = item.from + item.durationInFrames
    return rangesOverlap(proposedFrom, proposedEnd, item.from, itemEnd)
  })

  if (!collision) {
    // No collision - original position is fine
    return proposedFrom
  }

  // Try snapping to just before the colliding item
  const snapBackPosition = collision.from - durationInFrames

  // Can't go below frame 0
  if (snapBackPosition < 0) {
    return null
  }

  // Check if this position is available (no collision with previous items)
  if (hasAvailableSpace(snapBackPosition, durationInFrames, trackItems)) {
    return snapBackPosition
  }

  return null
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
  trackItems: ReadonlyArray<CollisionRect>,
): number | null {
  let testPosition = proposedFrom
  const MAX_ITERATIONS = 1000
  let iterations = 0

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const collision = trackItems.find((item) => {
      const itemEnd = item.from + item.durationInFrames
      const testEnd = testPosition + durationInFrames
      return rangesOverlap(testPosition, testEnd, item.from, itemEnd)
    })

    if (!collision) {
      return testPosition
    }

    // Snap to end of colliding item
    testPosition = collision.from + collision.durationInFrames
  }

  logger.error('findSpaceForward: too many iterations, aborting')
  return null
}

export function buildCollisionTrackItemsMap(
  allItems: ReadonlyArray<CollisionRect | TimelineItem>,
): Map<string, CollisionRect[]> {
  const trackItemsById = new Map<string, CollisionRect[]>()

  allItems.forEach((item) => {
    const existingTrackItems = trackItemsById.get(item.trackId)
    if (existingTrackItems) {
      existingTrackItems.push(item)
    } else {
      trackItemsById.set(item.trackId, [item])
    }
  })

  trackItemsById.forEach((trackItems) => {
    trackItems.sort(compareCollisionRectsByFrom)
  })

  return trackItemsById
}

export function findNearestAvailableSpaceInTrackItems(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>,
): number | null {
  // If no collision, return proposed position
  if (hasAvailableSpace(proposedFrom, durationInFrames, trackItems)) {
    return proposedFrom
  }

  // Find collision to determine distances
  const proposedEnd = proposedFrom + durationInFrames
  const collision = trackItems.find((item) => {
    const itemEnd = item.from + item.durationInFrames
    return rangesOverlap(proposedFrom, proposedEnd, item.from, itemEnd)
  })

  if (!collision) {
    // Shouldn't happen since hasAvailableSpace returned false, but handle it
    return proposedFrom
  }

  // Calculate distances to both edges
  const collisionEnd = collision.from + collision.durationInFrames
  const distanceToBackEdge = proposedFrom - (collision.from - durationInFrames)
  const distanceToFrontEdge = collisionEnd - proposedFrom

  // Try the closer edge first
  if (distanceToBackEdge <= distanceToFrontEdge) {
    // Try backward first
    const backwardPosition = findSpaceBackward(proposedFrom, durationInFrames, trackItems)
    if (backwardPosition !== null) {
      return backwardPosition
    }
    // Backward not available, try forward
    return findSpaceForward(proposedFrom, durationInFrames, trackItems)
  }

  // Try forward first
  const forwardPosition = findSpaceForward(proposedFrom, durationInFrames, trackItems)
  if (forwardPosition !== null) {
    return forwardPosition
  }
  // Forward not available, try backward
  return findSpaceBackward(proposedFrom, durationInFrames, trackItems)
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
  allItems: ReadonlyArray<CollisionRect | TimelineItem>,
): number | null {
  const trackItems = buildCollisionTrackItemsMap(allItems).get(trackId) ?? EMPTY_TRACK_ITEMS
  return findNearestAvailableSpaceInTrackItems(proposedFrom, durationInFrames, trackItems)
}

export interface OverlapInfo {
  itemA: string
  itemB: string
  trackId: string
  overlapFrames: number
}

/**
 * Detect non-transition overlapping items on the same track.
 * Transition-linked overlaps are intentional and excluded.
 */
export function detectOverlappingItems(
  items: ReadonlyArray<TimelineItem>,
  transitions: ReadonlyArray<Transition>,
): OverlapInfo[] {
  const transitionPairs = new Set<string>()
  for (const t of transitions) {
    transitionPairs.add(`${t.leftClipId}:${t.rightClipId}`)
    transitionPairs.add(`${t.rightClipId}:${t.leftClipId}`)
  }

  // Group by track
  const byTrack = new Map<string, TimelineItem[]>()
  for (const item of items) {
    let group = byTrack.get(item.trackId)
    if (!group) {
      group = []
      byTrack.set(item.trackId, group)
    }
    group.push(item)
  }

  const overlaps: OverlapInfo[] = []

  for (const [trackId, trackItems] of byTrack) {
    const sorted = [...trackItems].sort((a, b) => a.from - b.from)

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!
      const currentEnd = current.from + current.durationInFrames

      for (let j = i + 1; j < sorted.length; j++) {
        const next = sorted[j]!
        if (next.from >= currentEnd) break

        // Skip transition-linked pairs
        if (transitionPairs.has(`${current.id}:${next.id}`)) continue

        overlaps.push({
          itemA: current.id,
          itemB: next.id,
          trackId,
          overlapFrames: currentEnd - next.from,
        })
      }
    }
  }

  return overlaps
}

/**
 * Check if placing an item at the given position would overlap with
 * existing items on the same track, excluding transition-linked pairs
 * and the item itself.
 */
export function wouldOverlap(
  itemId: string,
  position: number,
  durationInFrames: number,
  trackId: string,
  allItems: ReadonlyArray<TimelineItem>,
  transitions: ReadonlyArray<Transition>,
): boolean {
  const transitionPairs = new Set<string>()
  for (const t of transitions) {
    if (t.leftClipId === itemId) transitionPairs.add(t.rightClipId)
    if (t.rightClipId === itemId) transitionPairs.add(t.leftClipId)
  }

  const end = position + durationInFrames
  return allItems.some((other) => {
    if (other.id === itemId) return false
    if (other.trackId !== trackId) return false
    if (transitionPairs.has(other.id)) return false
    const otherEnd = other.from + other.durationInFrames
    return rangesOverlap(position, end, other.from, otherEnd)
  })
}
