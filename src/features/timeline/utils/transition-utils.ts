/**
 * Transition Utilities
 *
 * Functions for validating and calculating transition parameters
 * between clips using the FCP-style overlap model.
 *
 * OVERLAP MODEL:
 * Transitions work by physically overlapping clips on the timeline.
 * When a transition of D frames is added, the right clip slides left by D frames
 * and its sourceStart is adjusted back by the equivalent source frames.
 * Both clips have real source content during the transition — no virtual extensions.
 *
 * COMPOSITION RULES:
 * 1. Transition duration must be < min(leftClipDuration, rightClipDuration)
 * 2. Right clip must have sufficient handle (pre-roll footage) for the overlap
 * 3. Each transition requires both leftClipId and rightClipId
 */

import type { TimelineItem } from '@/types/timeline';
import type { CanAddTransitionResult } from '@/types/transition';
import { getSourceProperties, sourceToTimelineFrames, getAvailableSourceFrames } from './source-calculations';

const FRAME_EPSILON = 1;

export function areFramesAligned(leftEnd: number, rightStart: number): boolean {
  return Math.abs(leftEnd - rightStart) <= FRAME_EPSILON;
}

/**
 * Check if two clips overlap (right clip starts before left clip ends).
 */
export function areFramesOverlapping(leftEnd: number, rightStart: number): boolean {
  return rightStart < leftEnd - FRAME_EPSILON;
}

/**
 * Check if a transition can be added between two clips.
 * Validates: same track, adjacency, clip types, duration limits, and handle availability.
 *
 * The right clip must have sufficient handle (pre-roll footage before its current
 * sourceStart) to accommodate the overlap. Without handle footage, the transition
 * would need source content that doesn't exist.
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

  // Check adjacency (for new transitions) or overlap (for existing transitions)
  const leftEnd = leftClip.from + leftClip.durationInFrames;
  const isAdjacent = areFramesAligned(leftEnd, rightClip.from);
  const isOverlapping = areFramesOverlapping(leftEnd, rightClip.from);
  if (!isAdjacent && !isOverlapping) {
    return { canAdd: false, reason: 'Clips must be adjacent or overlapping' };
  }

  // Check clip types - only video and image clips can have transitions
  const validTypes = ['video', 'image'];
  if (!validTypes.includes(leftClip.type) || !validTypes.includes(rightClip.type)) {
    return { canAdd: false, reason: 'Transitions only work with video and image clips' };
  }

  // Composition constraint: transition duration cannot exceed either clip's duration
  // Need at least 1 frame from each clip outside the transition
  const maxByClipDuration = Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1;
  if (durationInFrames > maxByClipDuration) {
    return {
      canAdd: false,
      reason: `Transition too long. Max: ${maxByClipDuration} frames (shorter clip duration - 1)`,
    };
  }

  const leftHandle = getAvailableHandle(leftClip, 'end');
  const rightHandle = getAvailableHandle(rightClip, 'start');

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
  const { sourceStart, sourceEnd, sourceDuration, speed } = getSourceProperties(clip);
  const effectiveSourceEnd = sourceEnd ?? sourceDuration ?? 0;
  const effectiveSourceDuration = sourceDuration ?? 0;

  if (side === 'start') {
    // Head handle: how much source is available before current start
    return sourceToTimelineFrames(sourceStart, speed);
  } else {
    // Tail handle: how much source is available after current end
    const availableAfter = getAvailableSourceFrames(effectiveSourceDuration, effectiveSourceEnd);
    return sourceToTimelineFrames(availableAfter, speed);
  }
}

