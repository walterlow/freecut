/**
 * Transition Utilities
 *
 * Functions for validating and calculating transition parameters
 * between clips using a cut-centered, handle-based model.
 *
 * CUT-CENTERED MODEL:
 * Transitions stay attached to the cut between adjacent clips.
 * Clip timeline positions do not move. Instead, the transition consumes hidden
 * source handles from the outgoing clip tail and incoming clip head.
 *
 * COMPOSITION RULES:
 * 1. Transition duration must be < min(leftClipDuration, rightClipDuration)
 * 2. Left/right clips must have sufficient source handles for their consumed portions
 * 3. Each transition requires both leftClipId and rightClipId
 */

import type { TimelineItem } from '@/types/timeline';
import type { CanAddTransitionResult } from '@/types/transition';
import { getSourceProperties, sourceToTimelineFrames, getAvailableSourceFrames } from './source-calculations';
import { calculateTransitionPortions } from '@/domain/timeline/transitions/transition-planner';

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

export function getMaxTransitionDurationForHandles(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  alignment: number | undefined,
): number {
  const maxByClipDuration = Math.floor(Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1);
  if (maxByClipDuration < 1) return 0;

  const leftHandle = getAvailableHandle(leftClip, 'end');
  const rightHandle = getAvailableHandle(rightClip, 'start');

  for (let duration = maxByClipDuration; duration >= 1; duration -= 1) {
    const portions = calculateTransitionPortions(duration, alignment);
    if (portions.leftPortion <= leftHandle && portions.rightPortion <= rightHandle) {
      return duration;
    }
  }

  return 0;
}

/**
 * Check if a transition can be added between two clips.
 * Validates: same track, adjacency, clip types, duration limits, and handle availability.
 *
 * Adjacent clips must have enough hidden handle footage to support the requested
 * transition portions around the cut. Existing legacy overlap transitions remain
 * valid as long as their clips still overlap.
 */
export function canAddTransition(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  durationInFrames: number,
  alignment?: number,
): CanAddTransitionResult {
  // Check same track
  if (leftClip.trackId !== rightClip.trackId) {
    return { canAdd: false, reason: 'Clips must be on the same track' };
  }

  // Check adjacency (current model) or overlap (legacy compatibility)
  const leftEnd = leftClip.from + leftClip.durationInFrames;
  const isAdjacent = areFramesAligned(leftEnd, rightClip.from);
  const isOverlapping = areFramesOverlapping(leftEnd, rightClip.from);
  if (!isAdjacent && !isOverlapping) {
    return { canAdd: false, reason: 'Clips must meet at the cut' };
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

  if (isAdjacent) {
    const portions = calculateTransitionPortions(durationInFrames, alignment);
    if (portions.leftPortion > leftHandle || portions.rightPortion > rightHandle) {
      const handleReason = [
        portions.leftPortion > leftHandle
          ? `left clip needs ${portions.leftPortion} tail-handle frames but only has ${leftHandle}`
          : null,
        portions.rightPortion > rightHandle
          ? `right clip needs ${portions.rightPortion} head-handle frames but only has ${rightHandle}`
          : null,
      ].filter(Boolean).join('; ');
      return {
        canAdd: false,
        reason: `Insufficient handle for transition: ${handleReason}`,
        leftHandle,
        rightHandle,
      };
    }
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
