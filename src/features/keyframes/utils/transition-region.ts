/**
 * Transition Region Utilities
 *
 * Functions to detect if a frame falls within a transition region for a clip.
 * Used to prevent keyframes from being placed during transition periods,
 * as keyframe animations would conflict with transition effects.
 */

import type { Transition } from '@/types/transition';
import type { TimelineItem } from '@/types/timeline';
import { calculateTransitionPortions } from '@/domain/timeline/transitions/transition-planner';

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
  let incomingTransition: Transition | undefined;
  let outgoingTransition: Transition | undefined;
  let incomingPortion = 0;
  let outgoingPortion = 0;

  for (const transition of transitions) {
    if (transition.leftClipId === clipId) {
      const portions = calculateTransitionPortions(
        transition.durationInFrames,
        transition.alignment
      );
      outgoingTransition = transition;
      outgoingPortion = portions.leftPortion;
    }

    if (transition.rightClipId === clipId) {
      const portions = calculateTransitionPortions(
        transition.durationInFrames,
        transition.alignment
      );
      incomingTransition = transition;
      incomingPortion = portions.rightPortion;
    }
  }

  // Keep blocked ranges chain-safe for clips with both incoming and outgoing transitions.
  if (incomingTransition && outgoingTransition) {
    const available = Math.max(0, clip.durationInFrames);
    const total = incomingPortion + outgoingPortion;
    if (total > available && total > 0) {
      const scale = available / total;
      incomingPortion = Math.floor(incomingPortion * scale);
      outgoingPortion = Math.floor(outgoingPortion * scale);

      const remainder = available - (incomingPortion + outgoingPortion);
      if (remainder > 0) {
        if (incomingPortion <= outgoingPortion) {
          incomingPortion += remainder;
        } else {
          outgoingPortion += remainder;
        }
      }
    }
  }

  if (incomingTransition && incomingPortion > 0) {
    blockedRanges.push({
      start: 0,
      end: Math.min(incomingPortion, clip.durationInFrames),
      transition: incomingTransition,
      role: 'incoming',
    });
  }

  if (outgoingTransition && outgoingPortion > 0) {
    blockedRanges.push({
      start: Math.max(0, clip.durationInFrames - outgoingPortion),
      end: clip.durationInFrames,
      transition: outgoingTransition,
      role: 'outgoing',
    });
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

