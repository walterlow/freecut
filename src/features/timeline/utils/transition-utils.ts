/**
 * Transition Utilities
 *
 * Functions for validating and calculating transition parameters
 * between adjacent clips.
 */

import type { TimelineItem } from '@/types/timeline';
import type { CanAddTransitionResult, Transition, TRANSITION_CONFIGS } from '@/types/transition';

/**
 * Check if a transition can be added between two clips.
 * Validates: same track, adjacency, and handle availability.
 */
export function canAddTransition(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  durationInFrames: number
): CanAddTransitionResult {
  // Check same track
  if (leftClip.trackId !== rightClip.trackId) {
    return { canAdd: false, reason: 'Clips must be on the same track' };
  }

  // Check adjacency (left clip ends where right clip starts)
  if (leftClip.from + leftClip.durationInFrames !== rightClip.from) {
    return { canAdd: false, reason: 'Clips must be adjacent' };
  }

  // Check clip types - only video and image clips can have transitions
  const validTypes = ['video', 'image'];
  if (!validTypes.includes(leftClip.type) || !validTypes.includes(rightClip.type)) {
    return { canAdd: false, reason: 'Transitions only work with video and image clips' };
  }

  // Calculate available handles
  const leftHandle = getAvailableHandle(leftClip, 'end');
  const rightHandle = getAvailableHandle(rightClip, 'start');

  // Check if both clips have enough handle
  if (leftHandle < durationInFrames) {
    return {
      canAdd: false,
      reason: `Left clip needs ${durationInFrames - leftHandle} more frames at end`,
      leftHandle,
      rightHandle,
    };
  }

  if (rightHandle < durationInFrames) {
    return {
      canAdd: false,
      reason: `Right clip needs ${durationInFrames - rightHandle} more frames at start`,
      leftHandle,
      rightHandle,
    };
  }

  return { canAdd: true, leftHandle, rightHandle };
}

/**
 * Calculate available handle frames on a clip.
 * Handle = unused source media beyond the current trim points.
 *
 * @param clip The timeline item
 * @param side 'start' for head handle, 'end' for tail handle
 * @returns Number of available frames for transition
 */
export function getAvailableHandle(
  clip: TimelineItem,
  side: 'start' | 'end'
): number {
  // Non-media items have infinite handles (no source constraints)
  if (clip.type === 'text' || clip.type === 'shape' || clip.type === 'adjustment') {
    return Infinity;
  }

  // Images can loop infinitely
  if (clip.type === 'image') {
    return Infinity;
  }

  // Audio items don't support visual transitions
  if (clip.type === 'audio') {
    return 0;
  }

  // Video items have source-based constraints
  const speed = clip.speed || 1;
  const sourceDuration = clip.sourceDuration || 0;
  const sourceStart = clip.sourceStart || 0;
  const sourceEnd = clip.sourceEnd || sourceDuration;

  if (side === 'start') {
    // Head handle: how much source is available before current start
    // sourceStart is already in source frames, divide by speed to get timeline frames
    return Math.floor(sourceStart / speed);
  } else {
    // Tail handle: how much source is available after current end
    // (sourceDuration - sourceEnd) in source frames, divide by speed
    return Math.floor((sourceDuration - sourceEnd) / speed);
  }
}

/**
 * Calculate the overlap region for a transition.
 * The right clip shifts left to overlap with the left clip.
 */
export function calculateOverlapRegion(
  _leftClip: TimelineItem,
  rightClip: TimelineItem,
  durationInFrames: number
): {
  overlapStart: number;
  overlapEnd: number;
  newRightFrom: number;
} {
  // Overlap starts where the right clip will move to
  const overlapStart = rightClip.from - durationInFrames;
  // Overlap ends at the original right clip start (now middle of transition)
  const overlapEnd = rightClip.from;
  // Right clip's new position
  const newRightFrom = overlapStart;

  return { overlapStart, overlapEnd, newRightFrom };
}

/**
 * Find the transition between two clips, if one exists.
 */
export function findTransitionBetween(
  transitions: Transition[],
  leftClipId: string,
  rightClipId: string
): Transition | undefined {
  return transitions.find(
    (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId
  );
}

/**
 * Get all transitions on a specific track.
 */
export function getTransitionsForTrack(
  transitions: Transition[],
  trackId: string
): Transition[] {
  return transitions.filter((t) => t.trackId === trackId);
}

/**
 * Get the transition involving a specific clip (as either left or right).
 */
export function getTransitionsForClip(
  transitions: Transition[],
  clipId: string
): Transition[] {
  return transitions.filter(
    (t) => t.leftClipId === clipId || t.rightClipId === clipId
  );
}

/**
 * Check if a clip is involved in any transition.
 */
export function clipHasTransition(
  transitions: Transition[],
  clipId: string
): boolean {
  return transitions.some(
    (t) => t.leftClipId === clipId || t.rightClipId === clipId
  );
}

/**
 * Calculate the maximum transition duration based on available handles.
 */
export function getMaxTransitionDuration(
  leftClip: TimelineItem,
  rightClip: TimelineItem
): number {
  const leftHandle = getAvailableHandle(leftClip, 'end');
  const rightHandle = getAvailableHandle(rightClip, 'start');
  return Math.min(leftHandle, rightHandle);
}

/**
 * Validate and clamp transition duration to valid range.
 */
export function clampTransitionDuration(
  duration: number,
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  config: typeof TRANSITION_CONFIGS[keyof typeof TRANSITION_CONFIGS]
): number {
  const maxDuration = getMaxTransitionDuration(leftClip, rightClip);
  return Math.max(
    config.minDuration,
    Math.min(duration, config.maxDuration, maxDuration)
  );
}
