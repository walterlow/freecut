/**
 * Transition Utilities
 *
 * Functions for validating and calculating transition parameters
 * between adjacent clips.
 *
 * COMPOSITION TRANSITIONSERIES RULES:
 * 1. Transition duration must be < min(leftClipDuration, rightClipDuration)
 * 2. No two transitions can be adjacent (must have a sequence/clip between them)
 * 3. Every transition must have a sequence/clip before AND after it
 *
 * Rules #2 and #3 are inherently satisfied by our data model:
 * - Each transition requires both leftClipId and rightClipId
 * - Transitions are stored separately and reference clips by ID
 * - We validate clips exist and are adjacent before creating transitions
 */

import type { TimelineItem } from '@/types/timeline';
import type { CanAddTransitionResult } from '@/types/transition';
import { getSourceProperties, sourceToTimelineFrames, getAvailableSourceFrames } from './source-calculations';

const FRAME_EPSILON = 1;

export function areFramesAligned(leftEnd: number, rightStart: number): boolean {
  return Math.abs(leftEnd - rightStart) <= FRAME_EPSILON;
}

/**
 * Check if a transition can be added between two clips.
 * Validates: same track, adjacency, and clip duration limits.
 *
 * NOTE: Handle availability is NOT required - the transition rendering uses
 * CSS mirroring (like CapCut) when source material is unavailable.
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
  if (!areFramesAligned(leftClip.from + leftClip.durationInFrames, rightClip.from)) {
    return { canAdd: false, reason: 'Clips must be adjacent' };
  }

  // Check clip types - only video and image clips can have transitions
  const validTypes = ['video', 'image'];
  if (!validTypes.includes(leftClip.type) || !validTypes.includes(rightClip.type)) {
    return { canAdd: false, reason: 'Transitions only work with video and image clips' };
  }

  // Composition constraint: transition duration cannot exceed either clip's duration
  // TransitionSeries needs at least 1 frame from each clip outside the transition
  const maxByClipDuration = Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1;
  if (durationInFrames > maxByClipDuration) {
    return {
      canAdd: false,
      reason: `Transition too long. Max: ${maxByClipDuration} frames (shorter clip duration - 1)`,
    };
  }

  // Calculate available handles (informational - not a blocking requirement)
  // When handles are insufficient, the transition renderer uses CSS mirroring
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
function getAvailableHandle(
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

