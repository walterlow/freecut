/**
 * Transition Region Utilities
 *
 * Functions to detect if a frame falls within a transition region for a clip.
 * Used to prevent keyframes from being placed during transition periods,
 * as keyframe animations would conflict with transition effects.
 */

import type { Transition } from '@/types/transition';
import type { TimelineItem } from '@/types/timeline';

/**
 * Frame range representing a blocked region (inclusive start, exclusive end)
 */
export interface BlockedFrameRange {
  /** Start frame (inclusive, relative to clip start) */
  start: number;
  /** End frame (exclusive, relative to clip start) */
  end: number;
  /** The transition that causes this blocked region */
  transition: Transition;
  /** Whether this clip is the outgoing (left) or incoming (right) clip */
  role: 'outgoing' | 'incoming';
}

/**
 * Get all transition-blocked frame ranges for a clip.
 * Returns frame ranges in clip-local coordinates (0 = first frame of clip).
 *
 * A clip can have at most 2 blocked ranges:
 * - One at the end if it's the left (outgoing) clip of a transition
 * - One at the start if it's the right (incoming) clip of a transition
 *
 * @param clipId - The clip ID to check
 * @param clip - The clip item (needed for duration)
 * @param transitions - All transitions in the timeline
 * @returns Array of blocked frame ranges
 */
export function getTransitionBlockedRanges(
  clipId: string,
  clip: TimelineItem,
  transitions: Transition[]
): BlockedFrameRange[] {
  const blockedRanges: BlockedFrameRange[] = [];

  for (const transition of transitions) {
    // Transition is centered on the cut point:
    // halfDuration = floor(durationInFrames / 2)
    // transitionStart = cutPoint - halfDuration
    // transitionEnd = cutPoint + ceil(durationInFrames / 2)
    const halfDuration = Math.floor(transition.durationInFrames / 2);
    const otherHalf = transition.durationInFrames - halfDuration; // ceil(durationInFrames / 2)

    if (transition.leftClipId === clipId) {
      // This clip is the outgoing (left) clip
      // Transition affects the last `halfDuration` frames of this clip
      const start = clip.durationInFrames - halfDuration;
      const end = clip.durationInFrames;

      blockedRanges.push({
        start: Math.max(0, start),
        end,
        transition,
        role: 'outgoing',
      });
    }

    if (transition.rightClipId === clipId) {
      // This clip is the incoming (right) clip
      // Transition affects the first `otherHalf` frames of this clip
      const start = 0;
      const end = otherHalf;

      blockedRanges.push({
        start,
        end: Math.min(end, clip.durationInFrames),
        transition,
        role: 'incoming',
      });
    }
  }

  return blockedRanges;
}

/**
 * Check if a specific frame is within a transition-blocked region.
 *
 * @param frame - Frame number relative to clip start (0-indexed)
 * @param clipId - The clip ID to check
 * @param clip - The clip item
 * @param transitions - All transitions in the timeline
 * @returns The blocking transition info if blocked, undefined otherwise
 */
export function isFrameInTransitionRegion(
  frame: number,
  clipId: string,
  clip: TimelineItem,
  transitions: Transition[]
): BlockedFrameRange | undefined {
  const blockedRanges = getTransitionBlockedRanges(clipId, clip, transitions);

  for (const range of blockedRanges) {
    if (frame >= range.start && frame < range.end) {
      return range;
    }
  }

  return undefined;
}

/**
 * Get a human-readable message explaining why keyframes are blocked.
 *
 * @param range - The blocked frame range
 * @returns User-friendly message
 */
export function getTransitionBlockedMessage(range: BlockedFrameRange): string {
  const position = range.role === 'outgoing' ? 'end' : 'start';
  return `Keyframes cannot be added here. This region is part of a transition at the ${position} of the clip.`;
}

/**
 * Check if a clip has any transitions attached to it.
 *
 * @param clipId - The clip ID to check
 * @param transitions - All transitions in the timeline
 * @returns true if the clip is part of any transition
 */
export function clipHasTransitions(
  clipId: string,
  transitions: Transition[]
): boolean {
  return transitions.some(
    (t) => t.leftClipId === clipId || t.rightClipId === clipId
  );
}
